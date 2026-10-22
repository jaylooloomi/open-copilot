import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { bearerAuth, type AuthEnv } from './auth';

function createProtectedApp() {
  const app = new Hono<AuthEnv>();
  app.use('/protected', bearerAuth(['key-a', 'key-b']));
  app.get('/protected', (c) => c.text(c.get('accessKey')));
  return app;
}

describe('bearerAuth', () => {
  it('returns 401 with unauthorized body when the header is missing', async () => {
    const res = await createProtectedApp().request('/protected');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
  });

  it('returns 401 for a wrong key, a non-Bearer scheme or an empty token', async () => {
    const app = createProtectedApp();
    for (const value of ['Bearer wrong', 'Basic key-a', 'Bearer ', 'key-a']) {
      const res = await app.request('/protected', { headers: { Authorization: value } });
      expect(res.status, value).toBe(401);
    }
  });

  it('passes through and exposes the matched key', async () => {
    const app = createProtectedApp();
    const resA = await app.request('/protected', { headers: { Authorization: 'Bearer key-a' } });
    expect(resA.status).toBe(200);
    expect(await resA.text()).toBe('key-a');

    const resB = await app.request('/protected', { headers: { Authorization: 'bearer key-b' } });
    expect(resB.status).toBe(200);
    expect(await resB.text()).toBe('key-b');
  });
});
