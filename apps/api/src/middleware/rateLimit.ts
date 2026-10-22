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
  // 接線錯誤要在啟動時就爆出來：NaN 的 windowMs 會讓金鑰永遠被鎖、Retry-After 變成 NaN。
  if (!(Number.isInteger(limit) && limit >= 0)) {
    throw new Error(`rateLimit limit must be a non-negative integer, got ${limit}`);
  }
  if (!(Number.isFinite(windowMs) && windowMs > 0)) {
    throw new Error(`rateLimit windowMs must be a positive finite number, got ${windowMs}`);
  }

  const buckets = new Map<string, Bucket>();

  return createMiddleware<AuthEnv>(async (c, next) => {
    // 必須掛在 bearerAuth 之後；沒有 accessKey 代表順序接錯，不能讓所有人默默共用一個桶。
    const key: string | undefined = c.get('accessKey');
    if (key === undefined) {
      throw new Error('rateLimit requires bearerAuth to set accessKey first');
    }
    const t = now();

    let bucket = buckets.get(key);
    // 時鐘倒退（NTP 校正、VM 恢復）也開新窗，否則舊窗會多活「倒退的量」。
    if (!bucket || t < bucket.windowStart || t >= bucket.windowStart + windowMs) {
      bucket = { windowStart: t, count: 0 };
      buckets.set(key, bucket);
    }

    if (bucket.count >= limit) {
      // 走到這裡時 t 必在窗內，ceil 已 ≥ 1；Math.max 只是防禦，避免日後改了開窗條件時回 Retry-After: 0。
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStart + windowMs - t) / 1000));
      c.header('Retry-After', String(retryAfterSeconds));
      return c.json({ error: 'rate_limited' } satisfies ApiErrorBody, 429);
    }

    bucket.count += 1;
    await next();
  });
}
