import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/apiClient';
import { RETRY_DELAYS_MS, withRetry } from './retry';

/** fn that fails with the given errors in turn, then resolves 'ok'. */
function failing(...errors: unknown[]) {
  return vi.fn(async () => {
    const error = errors.shift();
    if (error !== undefined) throw error;
    return 'ok';
  });
}

const sleepSpy = () => vi.fn(async (_ms: number) => undefined);

afterEach(() => {
  vi.useRealTimers();
});

describe('withRetry', () => {
  it('returns the first success without sleeping', async () => {
    const sleep = sleepSpy();
    expect(await withRetry(failing(), { sleep })).toBe('ok');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries network errors and 5xx after 1s, 2s and 4s', async () => {
    const sleep = sleepSpy();
    const fn = failing(new ApiError('net', 0), new ApiError('bad gateway', 502), new ApiError('down', 500));
    expect(RETRY_DELAYS_MS).toEqual([1000, 2000, 4000]);
    expect(await withRetry(fn, { sleep })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
  });

  it('gives up after 3 retries and throws the last error', async () => {
    const sleep = sleepSpy();
    const last = new ApiError('fourth', 500);
    const fn = failing(new ApiError('1', 500), new ApiError('2', 500), new ApiError('3', 500), last);
    await expect(withRetry(fn, { sleep })).rejects.toBe(last);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('waits Retry-After on 429 and counts it as a retry', async () => {
    const sleep = sleepSpy();
    const fn = failing(new ApiError('slow down', 429, { retryAfterMs: 7000 }), new ApiError('again', 429));
    expect(await withRetry(fn, { sleep })).toBe('ok');
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([7000, 2000]);
  });

  it.each([400, 401, 404, 413])('does not retry %i', async (status) => {
    const sleep = sleepSpy();
    const error = new ApiError('no', status);
    const fn = failing(error);
    await expect(withRetry(fn, { sleep })).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry errors that are not ApiError', async () => {
    const error = new TypeError('bug');
    const fn = failing(error);
    await expect(withRetry(fn, { sleep: sleepSpy() })).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses custom delays', async () => {
    const sleep = sleepSpy();
    const fn = failing(new ApiError('a', 503), new ApiError('b', 503));
    await expect(withRetry(fn, { sleep, delaysMs: [10] })).rejects.toThrow('b');
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([10]);
  });

  it('sleeps with real timers by default', async () => {
    vi.useFakeTimers();
    const fn = failing(new ApiError('net', 0));
    const result = withRetry(fn);
    await vi.advanceTimersByTimeAsync(999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
