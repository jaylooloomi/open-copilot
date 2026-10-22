import type { ApiErrorBody } from '@oc/shared';
import { createMiddleware } from 'hono/factory';
import type { AuthEnv } from './auth';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

interface Bucket {
  windowStart: number;
  count: number;
}

/**
 * 固定視窗限流：每把金鑰在第一次請求時開窗，窗內最多 limit 次。
 * 狀態只存在記憶體，僅適用單一實例部署。
 */
export function rateLimit({ limit, windowMs, now = Date.now }: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();

  return createMiddleware<AuthEnv>(async (c, next) => {
    const key = c.get('accessKey') ?? 'anonymous';
    const t = now();

    let bucket = buckets.get(key);
    if (!bucket || t >= bucket.windowStart + windowMs) {
      bucket = { windowStart: t, count: 0 };
      buckets.set(key, bucket);
    }

    if (bucket.count >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStart + windowMs - t) / 1000));
      c.header('Retry-After', String(retryAfterSeconds));
      return c.json({ error: 'rate_limited' } satisfies ApiErrorBody, 429);
    }

    bucket.count += 1;
    await next();
  });
}
