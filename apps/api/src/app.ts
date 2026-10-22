import {
  MAX_AUDIO_BYTES,
  RATE_LIMIT_PER_MINUTE,
  type ApiErrorBody,
  type HealthResponse,
  type TranscribeResponse,
} from '@oc/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { bearerAuth, type AuthEnv } from './middleware/auth';
import { rateLimit } from './middleware/rateLimit';
import { toTraditional } from './text/toTraditional';
import { UpstreamRateLimitError } from './transcriber/errors';
import type { Transcriber } from './transcriber/types';

export interface AppDeps {
  transcriber: Transcriber;
  accessKeys: string[];
  allowedOrigins: string[];
  now?: () => number;
}

/** multipart 邊界、seq、prompt 等欄位的額外空間；音訊本身另以 MAX_AUDIO_BYTES 檢查。 */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const RATE_LIMIT_WINDOW_MS = 60_000;
const SEQ_PATTERN = /^[1-9]\d*$/;

export function createApp({ transcriber, accessKeys, allowedOrigins, now = Date.now }: AppDeps) {
  const app = new Hono<AuthEnv>();

  // CORS 必須最先執行：預檢請求不帶 Authorization，且 401/413/429 回應也要有 CORS 標頭。
  app.use(
    '*',
    cors({
      origin: allowedOrigins,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      exposeHeaders: ['Retry-After'],
      maxAge: 600,
    }),
  );

  app.get('/health', (c) => c.json({ ok: true } satisfies HealthResponse));

  app.post(
    '/transcribe',
    bearerAuth(accessKeys),
    rateLimit({ limit: RATE_LIMIT_PER_MINUTE, windowMs: RATE_LIMIT_WINDOW_MS, now }),
    bodyLimit({
      maxSize: MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES,
      onError: (c) => c.json({ error: 'payload_too_large' } satisfies ApiErrorBody, 413),
    }),
    async (c) => {
      let body: Record<string, string | File>;
      try {
        body = await c.req.parseBody();
      } catch {
        return c.json({ error: 'bad_request' } satisfies ApiErrorBody, 400);
      }

      const audio = body['audio'];
      const rawSeq = body['seq'];
      const prompt = body['prompt'] ?? '';

      if (!(audio instanceof File) || audio.size === 0) {
        return c.json({ error: 'bad_request' } satisfies ApiErrorBody, 400);
      }
      if (audio.size > MAX_AUDIO_BYTES) {
        return c.json({ error: 'payload_too_large' } satisfies ApiErrorBody, 413);
      }
      if (typeof rawSeq !== 'string' || !SEQ_PATTERN.test(rawSeq)) {
        return c.json({ error: 'bad_request' } satisfies ApiErrorBody, 400);
      }
      const seq = Number(rawSeq);
      if (!Number.isSafeInteger(seq) || typeof prompt !== 'string') {
        return c.json({ error: 'bad_request' } satisfies ApiErrorBody, 400);
      }

      // 用戶端斷線（前端逾時、離開頁面）時 node-server 會 abort 這個 signal，上游呼叫跟著取消。
      const signal = c.req.raw.signal;
      let rawText: string;
      try {
        rawText = await transcriber.transcribe({ file: audio, prompt, signal });
      } catch (err) {
        // 用戶端仍在線且上游限流（例如 Groq 免費額度）：回 429，前端依 Retry-After 等待後重送。
        // 已斷線時優先當成斷線處理，不送 Retry-After。
        if (!signal.aborted && err instanceof UpstreamRateLimitError) {
          console.warn(`[transcribe] upstream rate limited; retry after ${err.retryAfterSeconds}s`);
          c.header('Retry-After', String(err.retryAfterSeconds));
          return c.json({ error: 'rate_limited' } satisfies ApiErrorBody, 429);
        }
        // 其餘情況一律回 502。
        if (signal.aborted) {
          // 回應已經沒人收；記一行說明，避免被誤認成上游故障。
          console.warn('[transcribe] client disconnected; upstream call cancelled');
        } else {
          // 只記錄錯誤訊息，不記錄金鑰或音訊內容。
          console.error('[transcribe] upstream error:', err instanceof Error ? err.message : String(err));
        }
        return c.json({ error: 'upstream_error' } satisfies ApiErrorBody, 502);
      }

      return c.json({ seq, text: toTraditional(rawText.trim()) } satisfies TranscribeResponse, 200);
    },
  );

  // 未知路徑或方法（例如 GET /transcribe、多了路徑前綴的後端網址）也回 JSON，M3b 才能一律解析錯誤 body。
  app.notFound((c) => c.json({ error: 'bad_request' } satisfies ApiErrorBody, 404));

  // 中介層與 handler 沒接住的例外（例如 toTraditional、parseBody 內部錯誤）回 JSON 500；只記錄訊息，不記錄金鑰或音訊。
  app.onError((err, c) => {
    console.error('[api] unhandled error:', err instanceof Error ? err.message : String(err));
    return c.json({ error: 'upstream_error' } satisfies ApiErrorBody, 500);
  });

  return app;
}
