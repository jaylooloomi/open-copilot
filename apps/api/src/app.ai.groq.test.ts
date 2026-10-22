import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGroqAssistant, createGroqLlmClient } from './ai/groqAssistant';
import { buildUserMessage, SUMMARY_SYSTEM_PROMPT, TODOS_SYSTEM_PROMPT } from './ai/prompts';
import { createApp } from './app';
import {
  blockRealNetwork,
  chatCompletionResponse,
  createFakeJsonUpstream,
  jsonResponse,
  type JsonUpstreamCall,
} from './test/fakeUpstream';
import { ALLOWED_ORIGIN, TEST_KEY, createFakeTranscriber, postAi } from './test/helpers';

/** 真的 app、真的 OpenAI SDK client（Groq 設定），只把上游 fetch 換成假的 Groq。 */
function createGroqAiApp(respond: (call: JsonUpstreamCall) => Response) {
  const upstream = createFakeJsonUpstream(respond);
  const assistant = createGroqAssistant(
    'gsk-test',
    'openai/gpt-oss-120b',
    createGroqLlmClient('gsk-test', { fetch: upstream.fetch }),
  );
  const app = createApp({
    transcriber: createFakeTranscriber(),
    assistant,
    accessKeys: [TEST_KEY],
    allowedOrigins: [ALLOWED_ORIGIN],
  });
  return { app, upstream };
}

const BODY = { title: '週會', text: '下週三前要寄出報價單，小王負責確認場地。' };

beforeEach(() => {
  blockRealNetwork();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /ai/* with Groq (mocked upstream)', () => {
  it('summarizes through Groq chat completions and returns Traditional Chinese', async () => {
    const { app, upstream } = createGroqAiApp(() => chatCompletionResponse(' • 下周三前寄出报价单 '));

    const res = await postAi(app, '/ai/summary', BODY);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summary: '• 下週三前寄出報價單' });
    expect(upstream.calls).toEqual([
      {
        url: 'https://api.groq.com/openai/v1/chat/completions',
        method: 'POST',
        authorization: 'Bearer gsk-test',
        body: {
          model: 'openai/gpt-oss-120b',
          messages: [
            { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
            { role: 'user', content: buildUserMessage(BODY.title, BODY.text) },
          ],
        },
      },
    ]);
  });

  it('extracts todos in JSON mode and returns validated Traditional Chinese items', async () => {
    const { app, upstream } = createGroqAiApp(() =>
      chatCompletionResponse('{"items":["- [ ] 寄出报价单","确认场地",""]}'),
    );

    const res = await postAi(app, '/ai/todos', BODY);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: ['寄出報價單', '確認場地'] });
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]!.body).toEqual({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: TODOS_SYSTEM_PROMPT },
        { role: 'user', content: buildUserMessage(BODY.title, BODY.text) },
      ],
      response_format: { type: 'json_object' },
    });
  });

  it('answers 429 rate_limited and forwards the Groq Retry-After, calling Groq once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, upstream } = createGroqAiApp(() =>
      jsonResponse(
        429,
        { error: { message: 'Rate limit reached', type: 'tokens', code: 'rate_limit_exceeded' } },
        { 'retry-after': '7' },
      ),
    );

    const res = await postAi(app, '/ai/todos', BODY, {
      Authorization: `Bearer ${TEST_KEY}`,
      Origin: ALLOWED_ORIGIN,
    });

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(res.headers.get('Retry-After')).toBe('7');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(upstream.calls).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith('[ai/todos] upstream rate limited; retry after 7s');
  });

  it.each([
    ['a server error', 500],
    ['a rejected API key', 401],
    ['an unknown model', 404],
  ])('answers 502 upstream_error when Groq returns %s, calling Groq once', async (_label, status) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, upstream } = createGroqAiApp(() =>
      jsonResponse(status, { error: { message: `groq ${status}` } }),
    );

    const res = await postAi(app, '/ai/summary', BODY);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream_error' });
    expect(upstream.calls).toHaveLength(1);
    expect(consoleError).toHaveBeenCalledWith('[ai/summary] upstream error:', expect.any(String));
    // 紀錄不可含金鑰或筆記內容。
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('gsk-test');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('報價單');
  });

  it('answers 502 upstream_error when the todo output is not valid JSON', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app } = createGroqAiApp(() => chatCompletionResponse('待辦：寄出報價單'));

    const res = await postAi(app, '/ai/todos', BODY);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream_error' });
    expect(consoleError).toHaveBeenCalledWith(
      '[ai/todos] upstream error:',
      'LLM returned invalid JSON',
    );
  });
});
