import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import {
  chatCompletionResponse,
  createFakeJsonUpstream,
  createFakeUpstream,
  jsonResponse,
} from './fakeUpstream';

describe('createFakeUpstream', () => {
  it('rejects with the abort reason when the request signal is already aborted', async () => {
    const upstream = createFakeUpstream(() => jsonResponse(200, { text: 'ok' }));
    const form = new FormData();
    form.append('model', 'whisper-1');
    const controller = new AbortController();
    controller.abort();

    await expect(
      upstream.fetch('https://upstream.test/v1/audio/transcriptions', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(upstream.calls).toHaveLength(0);
  });

  it('fails with a clear error for a request that is not multipart', async () => {
    const upstream = createFakeUpstream(() => jsonResponse(200, {}));

    await expect(
      upstream.fetch('https://upstream.test/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    ).rejects.toThrow(/only handles multipart/);
    expect(upstream.calls).toHaveLength(0);
  });
});

describe('createFakeJsonUpstream', () => {
  it('records the JSON body a real OpenAI SDK client sends and answers with a chat completion', async () => {
    const upstream = createFakeJsonUpstream(() => chatCompletionResponse('你好'));
    const client = new OpenAI({
      apiKey: 'test-key',
      baseURL: 'https://upstream.test/v1',
      organization: null,
      project: null,
      maxRetries: 0,
      fetch: upstream.fetch,
    });

    const completion = await client.chat.completions.create({
      model: 'test-model',
      messages: [{ role: 'user', content: '嗨' }],
    });

    expect(completion.choices[0]?.message.content).toBe('你好');
    expect(upstream.calls).toEqual([
      {
        url: 'https://upstream.test/v1/chat/completions',
        method: 'POST',
        authorization: 'Bearer test-key',
        body: { model: 'test-model', messages: [{ role: 'user', content: '嗨' }] },
      },
    ]);
  });

  it('answers with null content when asked to', async () => {
    const upstream = createFakeJsonUpstream(() => chatCompletionResponse(null));

    const res = await upstream.fetch('https://upstream.test/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(await res.json()).toMatchObject({ choices: [{ message: { content: null } }] });
  });

  it('rejects with the abort reason when the request signal is already aborted', async () => {
    const upstream = createFakeJsonUpstream(() => chatCompletionResponse('ok'));
    const controller = new AbortController();
    controller.abort();

    await expect(
      upstream.fetch('https://upstream.test/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(upstream.calls).toHaveLength(0);
  });

  it('fails with a clear error for a request that is not JSON', async () => {
    const upstream = createFakeJsonUpstream(() => chatCompletionResponse('ok'));

    await expect(
      upstream.fetch('https://upstream.test/v1/audio/transcriptions', {
        method: 'POST',
        body: new FormData(),
      }),
    ).rejects.toThrow(/only handles JSON/);
    expect(upstream.calls).toHaveLength(0);
  });

  it('fails with a clear error for a JSON request whose body is not valid JSON', async () => {
    const upstream = createFakeJsonUpstream(() => chatCompletionResponse('ok'));

    await expect(
      upstream.fetch('https://upstream.test/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
    ).rejects.toThrow(/createFakeJsonUpstream got an invalid JSON body/);
    expect(upstream.calls).toHaveLength(0);
  });
});
