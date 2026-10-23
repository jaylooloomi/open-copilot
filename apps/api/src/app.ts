import {
  AI_MAX_TEXT_CHARS,
  MAX_AUDIO_BYTES,
  RATE_LIMIT_PER_MINUTE,
  type AiRequest,
  type AiSummaryResponse,
  type AiTodosResponse,
  type ApiErrorBody,
  type HealthResponse,
  type TranscribeResponse,
} from '@oc/shared';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { parseAiRequest } from './ai/request';
import type { NoteAssistant } from './ai/types';
import { bearerAuth, type AuthEnv } from './middleware/auth';
import { rateLimit } from './middleware/rateLimit';
import { toTraditional } from './text/toTraditional';
import { UpstreamPayloadTooLargeError, UpstreamRateLimitError } from './transcriber/errors';
import type { Transcriber } from './transcriber/types';

export interface AppDeps {
  transcriber: Transcriber;
  /** AI 摘要／待辦事項；null 或省略（沒有 GROQ_API_KEY）時 /ai/* 回 503 ai_unavailable。 */
  assistant?: NoteAssistant | null;
  accessKeys: string[];
  allowedOrigins: string[];
  now?: () => number;
}

/** multipart 邊界、seq、prompt 等欄位的額外空間；音訊本身另以 MAX_AUDIO_BYTES 檢查。 */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** /ai/* 的 title 與 JSON 結構的額外空間；text 本身另以 AI_MAX_TEXT_CHARS 檢查。 */
export const AI_BODY_OVERHEAD_BYTES = 64 * 1024;

/**
 * /ai/* 的原始 body 上限：text 每個字在 JSON 裡最多 12 個位元組（emoji 等 BMP 以外的字可能被寫成
 * 兩個 \uXXXX 跳脫），再加上額外空間。這只擋掉離譜的 body；字數一律以 parseAiRequest 為準。
 */
export const AI_MAX_BODY_BYTES = AI_MAX_TEXT_CHARS * 12 + AI_BODY_OVERHEAD_BYTES;

const RATE_LIMIT_WINDOW_MS = 60_000;
const SEQ_PATTERN = /^[1-9]\d*$/;

/**
 * 上游呼叫失敗時的回應（/transcribe 與 /ai/* 共用）。
 * 用戶端仍在線且上游限流：回 429 並帶 Retry-After，前端等待後重送。
 * 上游說請求太大（例如 Groq 超過每分鐘 token 上限）：回 413 payload_too_large，重送也沒用。
 * 已斷線時優先當成斷線處理，不送 Retry-After；其餘情況一律回 502。
 * 只記錄錯誤訊息，不記錄金鑰、音訊或筆記內容。
 */
function upstreamFailure(c: Context, err: unknown, signal: AbortSignal, tag: string) {
  if (!signal.aborted && err instanceof UpstreamRateLimitError) {
    console.warn(`[${tag}] upstream rate limited; retry after ${err.retryAfterSeconds}s`);
    c.header('Retry-After', String(err.retryAfterSeconds));
    return c.json({ error: 'rate_limited' } satisfies ApiErrorBody, 429);
  }
  if (!signal.aborted && err instanceof UpstreamPayloadTooLargeError) {
    console.warn(`[${tag}] upstream rejected the request as too large`);
    return c.json({ error: 'payload_too_large' } satisfies ApiErrorBody, 413);
  }
  if (signal.aborted) {
    // 回應已經沒人收；記一行說明，避免被誤認成上游故障。
    console.warn(`[${tag}] client disconnected; upstream call cancelled`);
  } else {
    console.error(`[${tag}] upstream error:`, err instanceof Error ? err.message : String(err));
  }
  return c.json({ error: 'upstream_error' } satisfies ApiErrorBody, 502);
}

/** 讀取並驗證 /ai/* 的 JSON body；不合法時回傳要送出的錯誤回應（400 或 413）。 */
async function readAiRequest(c: Context): Promise<AiRequest | Response> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'bad_request' } satisfies ApiErrorBody, 400);
  }
  const parsed = parseAiRequest(raw);
  if (parsed === 'bad_request') {
    return c.json({ error: 'bad_request' } satisfies ApiErrorBody, 400);
  }
  if (parsed === 'payload_too_large') {
    return c.json({ error: 'payload_too_large' } satisfies ApiErrorBody, 413);
  }
  return parsed;
}

export function createApp({
  transcriber,
  assistant = null,
  accessKeys,
  allowedOrigins,
  now = Date.now,
}: AppDeps) {
  const app = new Hono<AuthEnv>();

  // CORS 必須最先執行：預檢請求不帶 Authorization，且 401/413/429/503 回應也要有 CORS 標頭。
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
        return upstreamFailure(c, err, signal, 'transcribe');
      }

      return c.json({ seq, text: toTraditional(rawText.trim()) } satisfies TranscribeResponse, 200);
    },
  );

  // /ai/summary 與 /ai/todos 共用一個限流桶（與 /transcribe 分開），按 AI 不會吃掉錄音轉寫的額度。
  const aiAuth = bearerAuth(accessKeys);
  const aiRateLimit = rateLimit({ limit: RATE_LIMIT_PER_MINUTE, windowMs: RATE_LIMIT_WINDOW_MS, now });
  const aiBodyLimit = bodyLimit({
    maxSize: AI_MAX_BODY_BYTES,
    onError: (c) => c.json({ error: 'payload_too_large' } satisfies ApiErrorBody, 413),
  });

  app.post('/ai/summary', aiAuth, aiRateLimit, aiBodyLimit, async (c) => {
    // 通過驗證後才告訴對方 AI 沒開；先於 body 驗證，前端看到 503 就知道是後端沒設定。
    if (!assistant) return c.json({ error: 'ai_unavailable' } satisfies ApiErrorBody, 503);
    const input = await readAiRequest(c);
    if (input instanceof Response) return input;

    const signal = c.req.raw.signal;
    let summary: string;
    try {
      summary = await assistant.summarize({ ...input, signal });
    } catch (err) {
      return upstreamFailure(c, err, signal, 'ai/summary');
    }
    return c.json({ summary: toTraditional(summary) } satisfies AiSummaryResponse, 200);
  });

  app.post('/ai/todos', aiAuth, aiRateLimit, aiBodyLimit, async (c) => {
    if (!assistant) return c.json({ error: 'ai_unavailable' } satisfies ApiErrorBody, 503);
    const input = await readAiRequest(c);
    if (input instanceof Response) return input;

    const signal = c.req.raw.signal;
    let items: string[];
    try {
      items = await assistant.extractTodos({ ...input, signal });
    } catch (err) {
      return upstreamFailure(c, err, signal, 'ai/todos');
    }
    // 先轉繁體再去重：模型可能同時給「开会」與「開會」，轉換後會變成重複項目。
    const converted = [...new Set(items.map((item) => toTraditional(item)))];
    return c.json({ items: converted } satisfies AiTodosResponse, 200);
  });

  // 未知路徑或方法（例如 GET /transcribe、多了路徑前綴的後端網址）也回 JSON，M3b 才能一律解析錯誤 body。
  app.notFound((c) => c.json({ error: 'bad_request' } satisfies ApiErrorBody, 404));

  // 中介層與 handler 沒接住的例外（例如 toTraditional、parseBody 內部錯誤）回 JSON 500；只記錄訊息，不記錄金鑰或音訊。
  app.onError((err, c) => {
    console.error('[api] unhandled error:', err instanceof Error ? err.message : String(err));
    return c.json({ error: 'upstream_error' } satisfies ApiErrorBody, 500);
  });

  return app;
}
