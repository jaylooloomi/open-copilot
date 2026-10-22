import { createHash, timingSafeEqual } from 'node:crypto';
import type { ApiErrorBody } from '@oc/shared';
import { createMiddleware } from 'hono/factory';

export type AuthEnv = { Variables: { accessKey: string } };

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function bearerAuth(accessKeys: string[]) {
  // 先雜湊成固定 32 bytes，timingSafeEqual 才不會因長度不同而丟錯或洩漏長度。
  const known = accessKeys.map((key) => ({ key, digest: sha256(key) }));

  return createMiddleware<AuthEnv>(async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
    const token = match?.[1] ?? '';
    const tokenDigest = sha256(token);

    // 每把金鑰都比對、不提早結束，避免從回應時間推測是哪一把。
    let matchedKey: string | undefined;
    for (const entry of known) {
      if (timingSafeEqual(entry.digest, tokenDigest)) {
        matchedKey = entry.key;
      }
    }

    if (token === '' || matchedKey === undefined) {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json({ error: 'unauthorized' } satisfies ApiErrorBody, 401);
    }

    c.set('accessKey', matchedKey);
    await next();
  });
}
