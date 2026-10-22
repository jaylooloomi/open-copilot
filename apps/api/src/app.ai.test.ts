import { AI_MAX_TEXT_CHARS, RATE_LIMIT_PER_MINUTE } from '@oc/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiOutputError } from './ai/output';
import { AI_MAX_BODY_BYTES } from './app';
import {
  ALLOWED_ORIGIN,
  OTHER_KEY,
  TEST_KEY,
  createFakeAssistant,
  createTestApp,
  postAi,
  postTranscribe,
  transcribeForm,
} from './test/helpers';
import { UpstreamRateLimitError } from './transcriber/errors';

const BODY = { title: '週會', text: '下週三前要寄出報價單。' };
const AUTH = { Authorization: `Bearer ${TEST_KEY}` };
const PATHS = ['/ai/summary', '/ai/todos'] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /ai/summary', () => {
  it('returns the summary in Traditional Chinese and passes title, text and the request signal', async () => {
    const assistant = createFakeAssistant({ summary: '• 下周三前寄出报价单' });
    const { app } = createTestApp({ assistant });

    const res = await postAi(app, '/ai/summary', BODY, { ...AUTH, Origin: ALLOWED_ORIGIN });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summary: '• 下週三前寄出報價單' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(assistant.summarize).toHaveBeenCalledTimes(1);
    const call = assistant.summarize.mock.calls[0]![0];
    expect(call.title).toBe('週會');
    expect(call.text).toBe('下週三前要寄出報價單。');
    expect(call.signal).toBeInstanceOf(AbortSignal);
    expect(assistant.extractTodos).not.toHaveBeenCalled();
  });
});

describe('POST /ai/todos', () => {
  it('returns the items in Traditional Chinese', async () => {
    const assistant = createFakeAssistant({ todos: ['寄出报价单', '确认场地'] });
    const { app } = createTestApp({ assistant });

    const res = await postAi(app, '/ai/todos', BODY);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: ['寄出報價單', '確認場地'] });
    expect(assistant.extractTodos).toHaveBeenCalledTimes(1);
    expect(assistant.summarize).not.toHaveBeenCalled();
  });

  it('returns an empty list when the note has no todos', async () => {
    const { app } = createTestApp({ assistant: createFakeAssistant({ todos: [] }) });

    const res = await postAi(app, '/ai/todos', BODY);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });
});

describe.each(PATHS)('%s guards', (path) => {
  it('returns 401 without a valid access key and never calls the assistant', async () => {
    const assistant = createFakeAssistant();
    const { app } = createTestApp({ assistant });

    const missing = await postAi(app, path, BODY, {});
    const wrong = await postAi(app, path, BODY, { Authorization: 'Bearer wrong-key' });

    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: 'unauthorized' });
    expect(wrong.status).toBe(401);
    expect(assistant.summarize).not.toHaveBeenCalled();
    expect(assistant.extractTodos).not.toHaveBeenCalled();
  });

  it('answers 503 ai_unavailable when no Groq key is configured, even for an invalid body', async () => {
    const { app } = createTestApp({ assistant: null });

    const res = await postAi(app, path, BODY, { ...AUTH, Origin: ALLOWED_ORIGIN });
    const invalid = await postAi(app, path, 'not json');

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'ai_unavailable' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(invalid.status).toBe(503);
  });

  it('still answers 401 before revealing that AI is unavailable', async () => {
    const { app } = createTestApp({ assistant: null });

    const res = await postAi(app, path, BODY, {});

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    ['an empty body', ''],
    ['a JSON array', [BODY]],
    ['a missing title', { text: '內容' }],
    ['a missing text', { title: '週會' }],
    ['a numeric text', { title: '週會', text: 42 }],
    ['a whitespace-only text', { title: '週會', text: ' \n\t' }],
  ] as const)('returns 400 bad_request for %s', async (_label, body) => {
    const assistant = createFakeAssistant();
    const { app } = createTestApp({ assistant });

    const res = await postAi(app, path, body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_request' });
    expect(assistant.summarize).not.toHaveBeenCalled();
    expect(assistant.extractTodos).not.toHaveBeenCalled();
  });

  it('accepts exactly AI_MAX_TEXT_CHARS characters, counting an emoji as one', async () => {
    const { app } = createTestApp();

    const cjk = await postAi(app, path, { title: '', text: '字'.repeat(AI_MAX_TEXT_CHARS) });
    const emoji = await postAi(app, path, { title: '', text: '😀'.repeat(AI_MAX_TEXT_CHARS) });

    expect(cjk.status).toBe(200);
    expect(emoji.status).toBe(200);
  });

  it('returns 413 payload_too_large one character over AI_MAX_TEXT_CHARS', async () => {
    const assistant = createFakeAssistant();
    const { app } = createTestApp({ assistant });

    const res = await postAi(app, path, { title: '', text: '字'.repeat(AI_MAX_TEXT_CHARS + 1) });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large' });
    expect(assistant.summarize).not.toHaveBeenCalled();
    expect(assistant.extractTodos).not.toHaveBeenCalled();
  });

  it('returns 413 payload_too_large for a raw body over AI_MAX_BODY_BYTES', async () => {
    const { app } = createTestApp();

    const res = await app.request(path, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: new Uint8Array(AI_MAX_BODY_BYTES + 1),
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large' });
  });

  it('answers 429 rate_limited with the upstream Retry-After when the LLM is rate limited', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const limited = new UpstreamRateLimitError(7);
    const { app } = createTestApp({
      assistant: createFakeAssistant({ summary: limited, todos: limited }),
    });

    const res = await postAi(app, path, BODY, { ...AUTH, Origin: ALLOWED_ORIGIN });

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(res.headers.get('Retry-After')).toBe('7');
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');
    expect(consoleWarn).toHaveBeenCalledWith(
      `[${path.slice(1)}] upstream rate limited; retry after 7s`,
    );
  });

  it.each([
    ['a plain upstream error', new Error('groq 500')],
    ['output that fails validation', new AiOutputError('LLM returned invalid JSON')],
  ])('answers 502 upstream_error for %s and logs only the message', async (_label, failure) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app } = createTestApp({
      assistant: createFakeAssistant({ summary: failure, todos: failure }),
    });

    const res = await postAi(app, path, BODY);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream_error' });
    expect(res.headers.get('Retry-After')).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(`[${path.slice(1)}] upstream error:`, failure.message);
    // 紀錄不可含筆記內容。
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('報價單');
  });

  it('treats a failure after the client disconnected as a disconnect: 502, no upstream error log', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const controller = new AbortController();
    const assistant = createFakeAssistant();
    const disconnect = async () => {
      controller.abort();
      throw new UpstreamRateLimitError(7);
    };
    assistant.summarize.mockImplementation(disconnect);
    assistant.extractTodos.mockImplementation(disconnect);
    const { app } = createTestApp({ assistant });

    const res = await postAi(app, path, BODY, AUTH, { signal: controller.signal });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream_error' });
    expect(res.headers.get('Retry-After')).toBeNull();
    expect(consoleWarn).toHaveBeenCalledWith(
      `[${path.slice(1)}] client disconnected; upstream call cancelled`,
    );
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('answers a CORS preflight that asks for Authorization and Content-Type', async () => {
    const { app } = createTestApp();

    const res = await app.request(path, {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
  });

  it('answers 404 bad_request for GET', async () => {
    const { app } = createTestApp();

    const res = await app.request(path, { headers: AUTH });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'bad_request' });
  });
});

describe('AI rate limit', () => {
  it('shares one per-key bucket between both AI endpoints, separate from /transcribe', async () => {
    const { app } = createTestApp({ now: () => 1_000_000 });

    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i += 1) {
      const res = await postAi(app, i % 2 === 0 ? '/ai/summary' : '/ai/todos', BODY);
      expect(res.status).toBe(200);
    }
    const limited = await postAi(app, '/ai/todos', BODY);

    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    expect(limited.headers.get('Retry-After')).toBe('60');
    // 另一把金鑰、以及同一把金鑰的 /transcribe 都不受影響。
    const other = await postAi(app, '/ai/summary', BODY, { Authorization: `Bearer ${OTHER_KEY}` });
    expect(other.status).toBe(200);
    expect((await postTranscribe(app, transcribeForm())).status).toBe(200);
  });
});
