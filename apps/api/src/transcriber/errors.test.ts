import { APIError } from 'openai';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UPSTREAM_RETRY_AFTER_SECONDS,
  MAX_UPSTREAM_RETRY_AFTER_SECONDS,
  UpstreamPayloadTooLargeError,
  UpstreamRateLimitError,
  parseRetryAfter,
  toUpstreamError,
} from './errors';

function apiError(status: number, headers: Record<string, string> = {}): APIError {
  return APIError.generate(
    status,
    { error: { message: `upstream ${status}` } },
    undefined,
    new Headers(headers),
  );
}

describe('parseRetryAfter', () => {
  it('reads delay-seconds', () => {
    expect(parseRetryAfter('7')).toBe(7);
    expect(parseRetryAfter(' 30 ')).toBe(30);
  });

  it('rounds fractional seconds up and never returns 0', () => {
    expect(parseRetryAfter('2.1')).toBe(3);
    expect(parseRetryAfter('0')).toBe(1);
    expect(parseRetryAfter('0.0')).toBe(1);
  });

  it('reads an HTTP-date relative to now', () => {
    const now = Date.parse('2026-10-22T08:00:00Z');
    expect(parseRetryAfter('Thu, 22 Oct 2026 08:00:15 GMT', now)).toBe(15);
    expect(parseRetryAfter('Thu, 22 Oct 2026 07:59:00 GMT', now)).toBe(1);
  });

  it('caps very long delays at 300 seconds', () => {
    const now = Date.parse('2026-10-22T08:00:00Z');
    expect(MAX_UPSTREAM_RETRY_AFTER_SECONDS).toBe(300);
    expect(parseRetryAfter('300')).toBe(300);
    expect(parseRetryAfter('301')).toBe(300);
    expect(parseRetryAfter('99999999999')).toBe(300);
    expect(parseRetryAfter('Fri, 22 Oct 2027 08:00:00 GMT', now)).toBe(300);
  });

  it('falls back to 10 seconds when the header is missing or unreadable', () => {
    expect(DEFAULT_UPSTREAM_RETRY_AFTER_SECONDS).toBe(10);
    for (const value of [null, undefined, '', '   ', 'soon', '-5', '1e3', '2026-10-22']) {
      expect(parseRetryAfter(value), String(value)).toBe(10);
    }
  });
});

describe('toUpstreamError', () => {
  it('turns an upstream 429 into UpstreamRateLimitError carrying Retry-After', () => {
    const original = apiError(429, { 'retry-after': '7' });

    const mapped = toUpstreamError(original);

    expect(mapped).toBeInstanceOf(UpstreamRateLimitError);
    const error = mapped as UpstreamRateLimitError;
    expect(error.retryAfterSeconds).toBe(7);
    expect(error.cause).toBe(original);
    expect(error.name).toBe('UpstreamRateLimitError');
    expect(error.message).toBe('upstream rate limited; retry after 7s');
  });

  it('uses 10 seconds when the upstream 429 has no Retry-After', () => {
    const mapped = toUpstreamError(apiError(429)) as UpstreamRateLimitError;
    expect(mapped).toBeInstanceOf(UpstreamRateLimitError);
    expect(mapped.retryAfterSeconds).toBe(10);
  });

  it('uses 10 seconds when the upstream 429 has no headers at all', () => {
    // APIError.generate(429, …, undefined) 會變成連線錯誤，所以直接建構一個沒有標頭的 429。
    const original = new APIError(429, { message: 'upstream 429' }, undefined, undefined);
    const mapped = toUpstreamError(original) as UpstreamRateLimitError;
    expect(mapped).toBeInstanceOf(UpstreamRateLimitError);
    expect(mapped.retryAfterSeconds).toBe(10);
  });

  it('reads an HTTP-date Retry-After from the upstream 429', () => {
    const at = new Date(Date.now() + 60_000).toUTCString();
    const mapped = toUpstreamError(apiError(429, { 'retry-after': at })) as UpstreamRateLimitError;
    expect(mapped).toBeInstanceOf(UpstreamRateLimitError);
    expect(mapped.retryAfterSeconds).toBeGreaterThanOrEqual(58);
    expect(mapped.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('turns an upstream 413 (for example Groq "Request too large" over the TPM budget) into UpstreamPayloadTooLargeError', () => {
    const original = apiError(413, { 'retry-after': '7' });

    const mapped = toUpstreamError(original);

    expect(mapped).toBeInstanceOf(UpstreamPayloadTooLargeError);
    const error = mapped as UpstreamPayloadTooLargeError;
    expect(error.cause).toBe(original);
    expect(error.name).toBe('UpstreamPayloadTooLargeError');
    expect(error.message).toBe('upstream rejected the request as too large');
  });

  it('passes every other error through unchanged', () => {
    for (const err of [apiError(500), apiError(401), new Error('boom'), 'text', undefined]) {
      expect(toUpstreamError(err)).toBe(err);
    }
  });
});
