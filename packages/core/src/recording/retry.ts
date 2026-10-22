import { ApiError } from '../api/apiClient';

/** Waits before retry 1, 2 and 3. */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000];

/** Longest wait honoured for a 429 Retry-After, so a huge value cannot stall the pipeline. */
export const MAX_RETRY_AFTER_MS = 60_000;

export interface RetryOptions {
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  /** Aborting stops further attempts and cuts a pending default sleep short; withRetry then rejects with signal.reason. */
  signal?: AbortSignal;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Calls fn, retrying network errors (status 0), 5xx and 429 once per entry in delaysMs.
 * A 429 waits Retry-After when the server sent one, capped at MAX_RETRY_AFTER_MS. Everything else (401, 400, 413, other 4xx,
 * non-ApiError) is thrown straight away; after the last retry the last error is thrown.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const delays = options.delaysMs ?? RETRY_DELAYS_MS;
  const { signal } = options;
  const sleep = options.sleep ?? ((ms: number) => abortableSleep(ms, signal));
  for (let attempt = 0; ; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return await fn();
    } catch (error) {
      const wait = attempt < delays.length ? retryDelay(error, delays[attempt]) : undefined;
      if (wait === undefined) throw error;
      signal?.throwIfAborted();
      await sleep(wait);
    }
  }
}

function retryDelay(error: unknown, fallbackMs: number): number | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.status === 429) return Math.min(error.retryAfterMs ?? fallbackMs, MAX_RETRY_AFTER_MS);
  if (error.status === 0 || error.status >= 500) return fallbackMs;
  return undefined;
}
