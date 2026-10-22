import type OpenAI from 'openai';
import { APIError } from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockRealNetwork, createFakeUpstream, jsonResponse } from '../test/fakeUpstream';
import { UpstreamRateLimitError } from './errors';
import {
  OPENAI_BASE_URL,
  OPENAI_MAX_RETRIES,
  OPENAI_TIMEOUT_MS,
  PROMPT_PREFIX,
  PROMPT_TAIL_CHARS,
  TRANSCRIBE_MODEL,
  buildPrompt,
  createOpenAIClient,
  createOpenAITranscriber,
} from './openaiTranscriber';

function createFakeClient(create: (...args: unknown[]) => Promise<unknown>) {
  const spy = vi.fn(create);
  const client = { audio: { transcriptions: { create: spy } } } as unknown as OpenAI;
  return { client, create: spy };
}

const file = new File([new Uint8Array([1, 2, 3])], 'segment-1.webm', { type: 'audio/webm' });

describe('buildPrompt', () => {
  it('prefixes the traditional Chinese guide text', () => {
    expect(buildPrompt('上一段的內容')).toBe('以下是繁體中文的語音內容。上一段的內容');
  });

  it('returns only the prefix for blank input', () => {
    expect(buildPrompt('   ')).toBe(PROMPT_PREFIX);
    expect(buildPrompt('')).toBe(PROMPT_PREFIX);
  });
});

describe('createOpenAITranscriber', () => {
  it('calls gpt-4o-mini-transcribe with zh language and prefixed prompt', async () => {
    const { client, create } = createFakeClient(async () => ({ text: '大家好' }));
    const transcriber = createOpenAITranscriber('sk-test', client);

    const text = await transcriber.transcribe({ file, prompt: '前文' });

    expect(text).toBe('大家好');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      {
        file,
        model: TRANSCRIBE_MODEL,
        language: 'zh',
        prompt: '以下是繁體中文的語音內容。前文',
        response_format: 'json',
      },
      { signal: undefined },
    );
    expect(TRANSCRIBE_MODEL).toBe('gpt-4o-mini-transcribe');
  });

  it('forwards the abort signal so a disconnected client cancels the billed upstream call', async () => {
    const { client, create } = createFakeClient(async () => ({ text: '大家好' }));
    const transcriber = createOpenAITranscriber('sk-test', client);
    const controller = new AbortController();

    await transcriber.transcribe({ file, prompt: '', signal: controller.signal });

    expect(create.mock.calls[0]![1]).toEqual({ signal: controller.signal });
    expect((create.mock.calls[0]![1] as { signal: AbortSignal }).signal).toBe(controller.signal);
  });

  it('propagates client errors', async () => {
    const { client } = createFakeClient(async () => {
      throw new Error('upstream down');
    });
    const transcriber = createOpenAITranscriber('sk-test', client);

    await expect(transcriber.transcribe({ file, prompt: '' })).rejects.toThrow('upstream down');
  });

  it('builds a single-attempt real client that answers before the 30 s frontend timeout (no network call)', () => {
    const client = createOpenAIClient('sk-test');
    expect(client.timeout).toBe(OPENAI_TIMEOUT_MS);
    expect(client.maxRetries).toBe(OPENAI_MAX_RETRIES);
    // M3b retries with withRetry and aborts each request after REQUEST_TIMEOUT_MS = 30_000 (upload included).
    expect(OPENAI_MAX_RETRIES).toBe(0);
    expect(OPENAI_TIMEOUT_MS).toBeLessThanOrEqual(25_000);

    const transcriber = createOpenAITranscriber('sk-test');
    expect(typeof transcriber.transcribe).toBe('function');
  });
});

describe('createOpenAIClient environment isolation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('always talks to api.openai.com, ignoring OPENAI_BASE_URL / OPENAI_ORG_ID / OPENAI_PROJECT_ID on the host', () => {
    // SDK 預設會讀這些環境變數；主機上若為別的工具設了 OPENAI_BASE_URL，音訊與金鑰會被送到那裡。
    vi.stubEnv('OPENAI_BASE_URL', 'http://127.0.0.1:18999/v1');
    vi.stubEnv('OPENAI_ORG_ID', 'org-other-tool');
    vi.stubEnv('OPENAI_PROJECT_ID', 'proj-other-tool');

    const client = createOpenAIClient('sk-test');

    expect(client.baseURL).toBe(OPENAI_BASE_URL);
    expect(OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
    expect(client.organization).toBeNull();
    expect(client.project).toBeNull();
    expect(client.apiKey).toBe('sk-test');
  });
});

describe('createOpenAITranscriber (M6)', () => {
  beforeEach(() => {
    blockRealNetwork();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps only the last 80 characters of a long prompt', async () => {
    const { client, create } = createFakeClient(async () => ({ text: '好' }));
    const transcriber = createOpenAITranscriber('sk-test', client);
    const tail = '乙'.repeat(PROMPT_TAIL_CHARS);

    await transcriber.transcribe({ file, prompt: '甲'.repeat(120) + tail });

    expect((create.mock.calls[0]![0] as { prompt: string }).prompt).toBe(PROMPT_PREFIX + tail);
  });

  it('turns an upstream 429 into UpstreamRateLimitError carrying Retry-After', async () => {
    const upstream429 = APIError.generate(
      429,
      { error: { message: 'Rate limit reached' } },
      undefined,
      new Headers({ 'retry-after': '12' }),
    );
    const { client } = createFakeClient(async () => {
      throw upstream429;
    });
    const transcriber = createOpenAITranscriber('sk-test', client);

    const err = await transcriber.transcribe({ file, prompt: '' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UpstreamRateLimitError);
    expect((err as UpstreamRateLimitError).retryAfterSeconds).toBe(12);
    expect((err as UpstreamRateLimitError).cause).toBe(upstream429);
  });

  it('sends the request to api.openai.com through an injected fetch', async () => {
    const upstream = createFakeUpstream(() => jsonResponse(200, { text: '你好' }));
    const transcriber = createOpenAITranscriber(
      'sk-test',
      createOpenAIClient('sk-test', { fetch: upstream.fetch }),
    );

    await expect(transcriber.transcribe({ file, prompt: '前文' })).resolves.toBe('你好');

    expect(upstream.calls).toEqual([
      {
        url: 'https://api.openai.com/v1/audio/transcriptions',
        authorization: 'Bearer sk-test',
        fields: {
          file: 'file:segment-1.webm',
          model: 'gpt-4o-mini-transcribe',
          language: 'zh',
          prompt: `${PROMPT_PREFIX}前文`,
          response_format: 'json',
        },
      },
    ]);
  });
});
