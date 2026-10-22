import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { blockRealNetwork, createFakeUpstream, jsonResponse, type UpstreamCall } from './test/fakeUpstream';
import { ALLOWED_ORIGIN, TEST_KEY, postTranscribe, transcribeForm } from './test/helpers';
import { createTranscriber } from './transcriber/createTranscriber';
import { PROMPT_PREFIX } from './transcriber/prompt';

/** 真的 app + 真的 OpenAI SDK client（Groq 設定），只把上游 fetch 換成假的 Groq。 */
function createGroqApp(respond: (call: UpstreamCall) => Response) {
  const upstream = createFakeUpstream(respond);
  const transcriber = createTranscriber(
    { provider: 'groq', apiKey: 'gsk-test', model: 'whisper-large-v3-turbo' },
    { fetch: upstream.fetch },
  );
  const app = createApp({ transcriber, accessKeys: [TEST_KEY], allowedOrigins: [ALLOWED_ORIGIN] });
  return { app, upstream };
}

const withOrigin = { Authorization: `Bearer ${TEST_KEY}`, Origin: ALLOWED_ORIGIN };

beforeEach(() => {
  blockRealNetwork();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /transcribe with Groq (mocked upstream)', () => {
  it('sends the segment to whisper-large-v3-turbo with a truncated prompt and returns traditional text', async () => {
    const { app, upstream } = createGroqApp(() => jsonResponse(200, { text: ' 这是测试 ' }));
    const tail = '乙'.repeat(60);

    const res = await postTranscribe(app, transcribeForm({ seq: '2', prompt: '甲'.repeat(140) + tail }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ seq: 2, text: '這是測試' });
    expect(upstream.calls).toEqual([
      {
        url: 'https://api.groq.com/openai/v1/audio/transcriptions',
        authorization: 'Bearer gsk-test',
        fields: {
          file: 'file:segment-1.webm',
          model: 'whisper-large-v3-turbo',
          language: 'zh',
          prompt: PROMPT_PREFIX + tail,
          response_format: 'json',
        },
      },
    ]);
  });

  it('answers 429 rate_limited and forwards the Groq Retry-After, calling Groq once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, upstream } = createGroqApp(() =>
      jsonResponse(
        429,
        { error: { message: 'Rate limit reached', type: 'requests', code: 'rate_limit_exceeded' } },
        { 'retry-after': '7' },
      ),
    );

    const res = await postTranscribe(app, transcribeForm(), withOrigin);

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(res.headers.get('Retry-After')).toBe('7');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');
    expect(upstream.calls).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith('[transcribe] upstream rate limited; retry after 7s');
  });

  it('uses Retry-After 10 when Groq answers 429 without one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app } = createGroqApp(() =>
      jsonResponse(429, { error: { message: 'Rate limit reached' } }),
    );

    const res = await postTranscribe(app, transcribeForm());

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('10');
  });

  it.each([
    ['a server error', 500],
    ['a rejected API key', 401],
  ])('answers 502 upstream_error when Groq returns %s, calling Groq once', async (_label, status) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, upstream } = createGroqApp(() =>
      jsonResponse(status, { error: { message: `groq ${status}` } }),
    );

    const res = await postTranscribe(app, transcribeForm());

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream_error' });
    expect(res.headers.get('Retry-After')).toBeNull();
    expect(upstream.calls).toHaveLength(1);
    expect(consoleError).toHaveBeenCalledWith('[transcribe] upstream error:', expect.any(String));
    // 紀錄不可含金鑰。
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('gsk-test');
  });
});
