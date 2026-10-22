import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockRealNetwork, createFakeUpstream, jsonResponse } from '../test/fakeUpstream';
import { createTranscriber } from './createTranscriber';
import { PROMPT_PREFIX } from './prompt';

const file = new File([new Uint8Array([1, 2, 3])], 'segment-1.webm', { type: 'audio/webm' });

beforeEach(() => {
  blockRealNetwork();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createTranscriber', () => {
  it('builds a Groq transcriber that uses the configured model', async () => {
    const upstream = createFakeUpstream(() => jsonResponse(200, { text: '你好' }));
    const transcriber = createTranscriber(
      { provider: 'groq', apiKey: 'gsk-test', model: 'whisper-large-v3' },
      { fetch: upstream.fetch },
    );

    await expect(transcriber.transcribe({ file, prompt: '' })).resolves.toBe('你好');

    expect(upstream.calls).toEqual([
      {
        url: 'https://api.groq.com/openai/v1/audio/transcriptions',
        authorization: 'Bearer gsk-test',
        fields: {
          file: 'file:segment-1.webm',
          model: 'whisper-large-v3',
          language: 'zh',
          prompt: PROMPT_PREFIX,
          response_format: 'json',
        },
      },
    ]);
  });

  it('builds an OpenAI transcriber on gpt-4o-mini-transcribe', async () => {
    const upstream = createFakeUpstream(() => jsonResponse(200, { text: '你好' }));
    const transcriber = createTranscriber(
      { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini-transcribe' },
      { fetch: upstream.fetch },
    );

    await expect(transcriber.transcribe({ file, prompt: '' })).resolves.toBe('你好');

    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]!.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(upstream.calls[0]!.authorization).toBe('Bearer sk-test');
    expect(upstream.calls[0]!.fields['model']).toBe('gpt-4o-mini-transcribe');
  });
});
