import { ApiError } from '../api/apiClient';

/** Waits before retry 1, 2 and 3. */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000];

export interface RetryOptions {
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Calls fn, retrying network errors (status 0), 5xx and 429 once per entry in delaysMs.
 * A 429 waits Retry-After when the server sent one. Everything else (401, 400, 413, other 4xx,
 * non-ApiError) is thrown straight away; after the last retry the last error is thrown.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const delays = options.delaysMs ?? RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const wait = attempt < delays.length ? retryDelay(error, delays[attempt]) : undefined;
      if (wait === undefined) throw error;
      await sleep(wait);
    }
  }
}

function retryDelay(error: unknown, fallbackMs: number): number | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.status === 429) return error.retryAfterMs ?? fallbackMs;
  if (error.status === 0 || error.status >= 500) return fallbackMs;
  return undefined;
}
