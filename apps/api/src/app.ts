import {
  MAX_AUDIO_BYTES,
  type ApiErrorBody,
  type HealthResponse,
  type TranscribeResponse,
} from '@oc/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { bearerAuth, type AuthEnv } from './middleware/auth';
import { toTraditional } from './text/toTraditional';
import type { Transcriber } from './transcriber/types';

export interface AppDeps {
  transcriber: Transcriber;
  accessKeys: string[];
  allowedOrigins: string[];
  now?: () => number;
}

/** multipart 邊界、seq、prompt 等欄位的額外空間；音訊本身另以 MAX_AUDIO_BYTES 檢查。 */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const SEQ_PATTERN = /^[1-9]\d*$/;

export function createApp({ transcriber, accessKeys, allowedOrigins }: AppDeps) {
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

      const rawText = await transcriber.transcribe({ file: audio, prompt });
      return c.json({ seq, text: toTraditional(rawText.trim()) } satisfies TranscribeResponse, 200);
    },
  );

  return app;
}
