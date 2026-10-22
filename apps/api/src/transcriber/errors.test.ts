import { APIError } from 'openai';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UPSTREAM_RETRY_AFTER_SECONDS,
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

  it('passes every other error through unchanged', () => {
    for (const err of [apiError(500), apiError(401), new Error('boom'), 'text', undefined]) {
      expect(toUpstreamError(err)).toBe(err);
    }
  });
});
