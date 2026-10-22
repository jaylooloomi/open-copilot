import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthEnv } from './auth';
import { rateLimit } from './rateLimit';

let clock = 0;

function createLimitedApp(limit = 2) {
  const app = new Hono<AuthEnv>();
  // Stand-in for bearerAuth: take the key from a test header.
  app.use(
    '*',
    createMiddleware<AuthEnv>(async (c, next) => {
      c.set('accessKey', c.req.header('x-test-key') ?? 'key-a');
      await next();
    }),
  );
  app.use('*', rateLimit({ limit, windowMs: 60_000, now: () => clock }));
  app.get('/', (c) => c.text('ok'));
  return app;
}

const hit = (app: Hono<AuthEnv>, key = 'key-a') =>
  app.request('/', { headers: { 'x-test-key': key } });

describe('rateLimit', () => {
  beforeEach(() => {
    clock = 1_000_000;
  });

  it('allows up to the limit, then returns 429 with Retry-After in whole seconds', async () => {
    const app = createLimitedApp(2);
    expect((await hit(app)).status).toBe(200);
    expect((await hit(app)).status).toBe(200);

    const res = await hit(app);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('rounds Retry-After up to the next second', async () => {
    const app = createLimitedApp(1);
    await hit(app);
    clock += 30_500; // 29.5 s left in the window
    const res = await hit(app);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');

    clock += 29_499; // 1 ms left
    expect((await hit(app)).headers.get('Retry-After')).toBe('1');
  });

  it('counts each access key separately', async () => {
    const app = createLimitedApp(1);
    expect((await hit(app, 'key-a')).status).toBe(200);
    expect((await hit(app, 'key-a')).status).toBe(429);
    expect((await hit(app, 'key-b')).status).toBe(200);
  });

  it('starts a fresh window once windowMs has elapsed', async () => {
    const app = createLimitedApp(1);
    expect((await hit(app)).status).toBe(200);
    expect((await hit(app)).status).toBe(429);
    clock += 60_000;
    expect((await hit(app)).status).toBe(200);
  });

  it('starts a fresh window when the clock steps backwards', async () => {
    const app = createLimitedApp(1);
    expect((await hit(app)).status).toBe(200);
    expect((await hit(app)).status).toBe(429);

    // Wall clock stepped back 100 s (NTP correction, VM resume): the old
    // window must not stay alive for windowMs plus the jump.
    clock -= 100_000;
    expect((await hit(app)).status).toBe(200);
    const res = await hit(app);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('throws at construction for an invalid limit or windowMs', () => {
    const now = () => clock;
    for (const limit of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => rateLimit({ limit, windowMs: 60_000, now })).toThrow(/limit/);
    }
    for (const windowMs of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      expect(() => rateLimit({ limit: 1, windowMs, now })).toThrow(/windowMs/);
    }
  });

  it('fails the request instead of sharing one bucket when no accessKey is set', async () => {
    // Mis-wired: rateLimit mounted without bearerAuth in front of it.
    const app = new Hono<AuthEnv>();
    app.use('*', rateLimit({ limit: 1, windowMs: 60_000, now: () => clock }));
    app.get('/', (c) => c.text('ok'));
    app.onError((err, c) => c.text(err.message, 500));

    const res = await app.request('/');
    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/accessKey/);
  });
});
