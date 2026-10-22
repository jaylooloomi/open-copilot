import { describe, expect, it } from 'vitest';
import { ALLOWED_ORIGIN, DENIED_ORIGIN, createTestApp } from './test/helpers';

describe('GET /health', () => {
  it('returns { ok: true } without an Authorization header', async () => {
    const { app } = createTestApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('adds Access-Control-Allow-Origin for an allowed origin', async () => {
    const { app } = createTestApp();
    const res = await app.request('/health', { headers: { Origin: ALLOWED_ORIGIN } });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
  });
});

describe('CORS preflight', () => {
  const preflight = (origin: string) => ({
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });

  it('allows a configured origin with Authorization and Retry-After exposed', async () => {
    const { app } = createTestApp();
    const res = await app.request('/transcribe', preflight(ALLOWED_ORIGIN));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');
  });

  it('allows the Electron app:// origin', async () => {
    const { app } = createTestApp();
    const res = await app.request('/transcribe', preflight('app://bundle'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('app://bundle');
  });

  it('omits Access-Control-Allow-Origin for an unknown origin', async () => {
    const { app } = createTestApp();
    const res = await app.request('/transcribe', preflight(DENIED_ORIGIN));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
