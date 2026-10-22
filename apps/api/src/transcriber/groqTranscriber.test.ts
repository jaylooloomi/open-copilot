import type OpenAI from 'openai';
import { APIError } from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockRealNetwork, createFakeUpstream, jsonResponse } from '../test/fakeUpstream';
import { UpstreamRateLimitError } from './errors';
import {
  GROQ_BASE_URL,
  GROQ_DEFAULT_TRANSCRIBE_MODEL,
  createGroqClient,
  createGroqTranscriber,
} from './groqTranscriber';
import { OPENAI_MAX_RETRIES, OPENAI_TIMEOUT_MS } from './openaiTranscriber';
import { PROMPT_PREFIX, PROMPT_TAIL_CHARS } from './prompt';

function createFakeClient(create: (...args: unknown[]) => Promise<unknown>) {
  const spy = vi.fn(create);
  const client = { audio: { transcriptions: { create: spy } } } as unknown as OpenAI;
  return { client, create: spy };
}

const file = new File([new Uint8Array([1, 2, 3])], 'segment-1.webm', { type: 'audio/webm' });

beforeEach(() => {
  blockRealNetwork();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('createGroqTranscriber', () => {
  it('calls whisper-large-v3-turbo with zh language and a prefixed prompt by default', async () => {
    const { client, create } = createFakeClient(async () => ({ text: '大家好' }));
    const transcriber = createGroqTranscriber('gsk-test', undefined, client);

    const text = await transcriber.transcribe({ file, prompt: '前文' });

    expect(text).toBe('大家好');
    expect(GROQ_DEFAULT_TRANSCRIBE_MODEL).toBe('whisper-large-v3-turbo');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      {
        file,
        model: 'whisper-large-v3-turbo',
        language: 'zh',
        prompt: `${PROMPT_PREFIX}前文`,
        response_format: 'json',
      },
      { signal: undefined },
    );
  });

  it('uses the model it is given', async () => {
    const { client, create } = createFakeClient(async () => ({ text: '' }));
    const transcriber = createGroqTranscriber('gsk-test', 'whisper-large-v3', client);

    await transcriber.transcribe({ file, prompt: '' });

    expect((create.mock.calls[0]![0] as { model: string }).model).toBe('whisper-large-v3');
  });

  it('keeps only the last 60 characters of a long prompt', async () => {
    const { client, create } = createFakeClient(async () => ({ text: '' }));
    const transcriber = createGroqTranscriber('gsk-test', undefined, client);
    const tail = '乙'.repeat(PROMPT_TAIL_CHARS);

    await transcriber.transcribe({ file, prompt: '甲'.repeat(120) + tail });

    expect((create.mock.calls[0]![0] as { prompt: string }).prompt).toBe(PROMPT_PREFIX + tail);
  });

  it('forwards the abort signal so a disconnected client cancels the upstream call', async () => {
    const { client, create } = createFakeClient(async () => ({ text: '' }));
    const transcriber = createGroqTranscriber('gsk-test', undefined, client);
    const controller = new AbortController();

    await transcriber.transcribe({ file, prompt: '', signal: controller.signal });

    expect((create.mock.calls[0]![1] as { signal: AbortSignal }).signal).toBe(controller.signal);
  });

  it('turns a Groq 429 into UpstreamRateLimitError carrying Retry-After', async () => {
    const upstream429 = APIError.generate(
      429,
      { error: { message: 'Rate limit reached for model whisper-large-v3-turbo' } },
      undefined,
      new Headers({ 'retry-after': '7' }),
    );
    const { client } = createFakeClient(async () => {
      throw upstream429;
    });
    const transcriber = createGroqTranscriber('gsk-test', undefined, client);

    const err = await transcriber.transcribe({ file, prompt: '' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UpstreamRateLimitError);
    expect((err as UpstreamRateLimitError).retryAfterSeconds).toBe(7);
  });

  it('propagates other errors unchanged', async () => {
    const failure = new Error('upstream down');
    const { client } = createFakeClient(async () => {
      throw failure;
    });
    const transcriber = createGroqTranscriber('gsk-test', undefined, client);

    await expect(transcriber.transcribe({ file, prompt: '' })).rejects.toBe(failure);
  });
});

describe('createGroqClient', () => {
  it('talks only to api.groq.com with a single attempt and the shared timeout', () => {
    // SDK 預設會讀這些環境變數；主機上若為別的工具設了它們，音訊與金鑰會被送到別處。
    vi.stubEnv('OPENAI_BASE_URL', 'http://127.0.0.1:18999/v1');
    vi.stubEnv('OPENAI_ORG_ID', 'org-other-tool');
    vi.stubEnv('OPENAI_PROJECT_ID', 'proj-other-tool');

    const client = createGroqClient('gsk-test');

    expect(GROQ_BASE_URL).toBe('https://api.groq.com/openai/v1');
    expect(client.baseURL).toBe(GROQ_BASE_URL);
    expect(client.organization).toBeNull();
    expect(client.project).toBeNull();
    expect(client.apiKey).toBe('gsk-test');
    expect(client.timeout).toBe(OPENAI_TIMEOUT_MS);
    expect(client.maxRetries).toBe(OPENAI_MAX_RETRIES);
  });

  it('posts multipart audio to the Groq transcription endpoint through an injected fetch', async () => {
    const upstream = createFakeUpstream(() => jsonResponse(200, { text: '你好' }));
    const transcriber = createGroqTranscriber(
      'gsk-test',
      GROQ_DEFAULT_TRANSCRIBE_MODEL,
      createGroqClient('gsk-test', { fetch: upstream.fetch }),
    );

    await expect(transcriber.transcribe({ file, prompt: '前文' })).resolves.toBe('你好');

    expect(upstream.calls).toEqual([
      {
        url: 'https://api.groq.com/openai/v1/audio/transcriptions',
        authorization: 'Bearer gsk-test',
        fields: {
          file: 'file:segment-1.webm',
          model: 'whisper-large-v3-turbo',
          language: 'zh',
          prompt: `${PROMPT_PREFIX}前文`,
          response_format: 'json',
        },
      },
    ]);
  });
});
