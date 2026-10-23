import { APIError } from 'openai';

/** 上游 429 沒帶 Retry-After（或看不懂）時，要前端等待的秒數。 */
export const DEFAULT_UPSTREAM_RETRY_AFTER_SECONDS = 10;

/** 上游要求等太久（例如每日額度用完）時，最多只叫前端等這麼多秒，避免卡住重試。 */
export const MAX_UPSTREAM_RETRY_AFTER_SECONDS = 300;

const DELAY_SECONDS = /^\d+(?:\.\d+)?$/;
// RFC 9110 的 IMF-fixdate，例如 "Thu, 22 Oct 2026 08:00:15 GMT"。
const IMF_FIXDATE = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/** 轉寫服務（Groq／OpenAI）回 429：app.ts 改回 429 rate_limited，並帶 Retry-After。 */
export class UpstreamRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, options?: ErrorOptions) {
    super(`upstream rate limited; retry after ${retryAfterSeconds}s`, options);
    this.name = 'UpstreamRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * 上游回 413：請求太大。Groq 免費額度在單次請求超過每分鐘 token 上限（TPM）時也回 413「Request too large」。
 * 同樣的請求重送也不會成功，所以 app.ts 回 413 payload_too_large（不帶 Retry-After），不回可重試的 502。
 */
export class UpstreamPayloadTooLargeError extends Error {
  constructor(options?: ErrorOptions) {
    super('upstream rejected the request as too large', options);
    this.name = 'UpstreamPayloadTooLargeError';
  }
}

/** 解析上游的 Retry-After（秒數或 HTTP 日期），回傳 1–300 的整數秒；看不懂就回 10。 */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number {
  const raw = value?.trim() ?? '';
  if (DELAY_SECONDS.test(raw)) {
    return clampSeconds(Number(raw));
  }
  if (IMF_FIXDATE.test(raw)) {
    const at = Date.parse(raw);
    if (!Number.isNaN(at)) return clampSeconds((at - now) / 1000);
  }
  return DEFAULT_UPSTREAM_RETRY_AFTER_SECONDS;
}

function clampSeconds(seconds: number): number {
  return Math.min(MAX_UPSTREAM_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(seconds)));
}

/**
 * 把上游 SDK 的錯誤轉成 app.ts 認得的型別：429 → UpstreamRateLimitError，
 * 413 → UpstreamPayloadTooLargeError，其他原樣回傳。
 * 兩種轉寫服務都走 OpenAI SDK，所以都用 APIError 判斷。
 */
export function toUpstreamError(err: unknown): unknown {
  if (err instanceof APIError && err.status === 429) {
    return new UpstreamRateLimitError(parseRetryAfter(err.headers?.get('retry-after')), {
      cause: err,
    });
  }
  if (err instanceof APIError && err.status === 413) {
    return new UpstreamPayloadTooLargeError({ cause: err });
  }
  return err;
}
