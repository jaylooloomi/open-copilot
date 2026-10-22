import { MAX_AUDIO_BYTES, RATE_LIMIT_PER_MINUTE } from '@oc/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MULTIPART_OVERHEAD_BYTES } from './app';
import {
  ALLOWED_ORIGIN,
  OTHER_KEY,
  TEST_KEY,
  createFakeTranscriber,
  createTestApp,
  postTranscribe,
  transcribeForm,
} from './test/helpers';
import type { Transcriber } from './transcriber/types';

afterEach(() => {
  vi.restoreAllMocks();
});

/** 超過 bodyLimit 上限、且 handler 不會解析的原始 body：只有 bodyLimit 會回 413。 */
function postOversizedRaw(app: ReturnType<typeof createTestApp>['app']) {
  return app.request('/transcribe', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TEST_KEY}`, 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES + 1),
  });
}

describe('POST /transcribe rate limit', () => {
  it('returns 429 with Retry-After after RATE_LIMIT_PER_MINUTE requests per key', async () => {
    let clock = 5_000_000;
    const { app } = createTestApp({ now: () => clock });

    for (let i = 1; i <= RATE_LIMIT_PER_MINUTE; i++) {
      const ok = await postTranscribe(app, transcribeForm({ seq: String(i) }));
      expect(ok.status).toBe(200);
    }

    clock += 15_000;
    const limited = await postTranscribe(app, transcribeForm({ seq: '61' }), {
      Authorization: `Bearer ${TEST_KEY}`,
      Origin: ALLOWED_ORIGIN,
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    expect(limited.headers.get('Retry-After')).toBe('45');
    expect(limited.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(limited.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');

    const otherKey = await postTranscribe(app, transcribeForm(), {
      Authorization: `Bearer ${OTHER_KEY}`,
    });
    expect(otherKey.status).toBe(200);

    clock += 45_000;
    const afterWindow = await postTranscribe(app, transcribeForm({ seq: '61' }));
    expect(afterWindow.status).toBe(200);
  });

  it('checks the rate limit before bodyLimit reads an oversized body', async () => {
    const { app } = createTestApp({ now: () => 7_000_000 });
    for (let i = 1; i <= RATE_LIMIT_PER_MINUTE; i++) {
      const ok = await postTranscribe(app, transcribeForm({ seq: String(i) }));
      expect(ok.status).toBe(200);
    }

    const res = await postOversizedRaw(app);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
  });
});

describe('POST /transcribe upstream failure', () => {
  it('returns 502 upstream_error when the transcriber throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app } = createTestApp({
      transcriber: createFakeTranscriber(new Error('OpenAI 500')),
    });

    const res = await postTranscribe(app, transcribeForm());

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream_error' });
    expect(consoleError).toHaveBeenCalledWith('[transcribe] upstream error:', 'OpenAI 500');
  });
});

describe('JSON fallbacks', () => {
  it('answers unknown paths and methods with a JSON 404 that keeps CORS headers', async () => {
    const { app } = createTestApp();
    for (const [method, path] of [
      ['GET', '/nope'],
      ['GET', '/transcribe'],
    ] as const) {
      const label = `${method} ${path}`;
      const res = await app.request(path, { method, headers: { Origin: ALLOWED_ORIGIN } });
      expect(res.status, label).toBe(404);
      expect(res.headers.get('Content-Type'), label).toMatch(/^application\/json/);
      expect(await res.json(), label).toEqual({ error: 'bad_request' });
      expect(res.headers.get('Access-Control-Allow-Origin'), label).toBe(ALLOWED_ORIGIN);
    }
  });

  it('answers an unexpected error with a JSON 500', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 回傳非字串讓 handler 的 rawText.trim() 丟 TypeError——發生在轉寫的 try/catch 之外。
    const transcriber = {
      transcribe: vi.fn<Transcriber['transcribe']>(async () => undefined as unknown as string),
    };
    const { app } = createTestApp({ transcriber });

    const res = await postTranscribe(app, transcribeForm());

    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Type')).toMatch(/^application\/json/);
    expect(await res.json()).toEqual({ error: 'upstream_error' });
    expect(consoleError).toHaveBeenCalledWith('[api] unhandled error:', expect.any(String));
  });
});
