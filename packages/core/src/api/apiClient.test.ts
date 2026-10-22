import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, parseRetryAfter } from './apiClient';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/** A fetch stand-in that records each call and answers with `respond`. */
function fakeFetch(respond: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return respond(String(input), init);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const audio = () => new Blob(['RIFF'], { type: 'audio/webm' });

/** Runs a rejecting promise and returns its error. */
async function errorOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('expected the promise to reject');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createApiClient().transcribe', () => {
  it('posts audio, seq and prompt as multipart with the bearer key', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ seq: 3, text: '你好' }));
    const client = createApiClient({ baseUrl: 'https://api.test/', accessKey: 'key-1', fetchImpl });

    const result = await client.transcribe({ audio: audio(), seq: 3, prompt: '上一段', filename: 'segment-3.webm' });

    expect(result).toEqual({ seq: 3, text: '你好' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.test/transcribe');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({ Authorization: 'Bearer key-1' });
    const form = calls[0].init.body as FormData;
    expect(form.get('seq')).toBe('3');
    expect(form.get('prompt')).toBe('上一段');
    const file = form.get('audio') as File;
    expect(file.name).toBe('segment-3.webm');
    expect(file.type).toBe('audio/webm');
  });

  it('turns an error status into ApiError with the server error code', async () => {
    const { fetchImpl } = fakeFetch(() => json({ error: 'unauthorized' }, 401));
    const client = createApiClient({ baseUrl: 'https://api.test', accessKey: 'bad', fetchImpl });

    const error = await errorOf(client.transcribe({ audio: audio(), seq: 1, prompt: '', filename: 'a.webm' }));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.code).toBe('unauthorized');
    expect(error.retryAfterMs).toBeUndefined();
  });

  it('reads Retry-After from a 429', async () => {
    const { fetchImpl } = fakeFetch(() => json({ error: 'rate_limited' }, 429, { 'Retry-After': '3' }));
    const client = createApiClient({ baseUrl: 'https://api.test', accessKey: 'k', fetchImpl });

    const error = await errorOf(client.transcribe({ audio: audio(), seq: 1, prompt: '', filename: 'a.webm' }));

    expect(error.status).toBe(429);
    expect(error.retryAfterMs).toBe(3000);
  });

  it('keeps the status when an error body is not JSON (e.g. a proxy page)', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    const client = createApiClient({ baseUrl: 'https://api.test', accessKey: 'k', fetchImpl });

    const error = await errorOf(client.transcribe({ audio: audio(), seq: 1, prompt: '', filename: 'a.webm' }));

    expect(error.status).toBe(502);
    expect(error.code).toBeUndefined();
  });

  it('reports a network failure as status 0', async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const client = createApiClient({ baseUrl: 'https://api.test', accessKey: 'k', fetchImpl });

    const error = await errorOf(client.transcribe({ audio: audio(), seq: 1, prompt: '', filename: 'a.webm' }));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
  });

  it('rejects a 200 whose body is not a transcribe response', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('<html>login</html>', { status: 200 }));
    const client = createApiClient({ baseUrl: 'https://api.test', accessKey: 'k', fetchImpl });

    const error = await errorOf(client.transcribe({ audio: audio(), seq: 1, prompt: '', filename: 'a.webm' }));

    expect(error.status).toBe(200);
    expect(error.message).toBe('Invalid transcribe response');
  });

  it('aborts a request that takes longer than timeoutMs and reports it as status 0', async () => {
    vi.useFakeTimers();
    const { fetchImpl } = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const client = createApiClient({ baseUrl: 'https://api.test', accessKey: 'k', fetchImpl, timeoutMs: 5000 });

    const pending = errorOf(client.transcribe({ audio: audio(), seq: 1, prompt: '', filename: 'a.webm' }));
    await vi.advanceTimersByTimeAsync(5000);

    expect((await pending).status).toBe(0);
  });

  it('keeps the timeout running while the response body is read', async () => {
    vi.useFakeTimers();
    const { fetchImpl } = fakeFetch((_url, init) => stalledBody(init, 200));
    const client = createApiClient({ baseUrl: 'https://api.test', accessKey: 'k', fetchImpl, timeoutMs: 5000 });

    const pending = errorOf(client.transcribe({ audio: audio(), seq: 1, prompt: '', filename: 'a.webm' }));
    await vi.advanceTimersByTimeAsync(5000);

    expect((await pending).status).toBe(0);
  });
});

/** Headers arrive at once, but the body never finishes until the request is aborted. */
function stalledBody(init: RequestInit, status: number): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"seq":'));
      init.signal?.addEventListener('abort', () =>
        controller.error(new DOMException('aborted', 'AbortError')),
      );
    },
  });
  return new Response(stream, { status, headers: { 'Content-Type': 'application/json' } });
}

describe('createApiClient().health', () => {
  it('is true only for 200 { ok: true } from GET /health, without the key', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ ok: true }));
    const client = createApiClient({ baseUrl: 'http://localhost:8787', accessKey: 'k', fetchImpl });

    expect(await client.health()).toBe(true);
    expect(calls[0].url).toBe('http://localhost:8787/health');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.headers).toBeUndefined();
  });

  it('is false for errors, other bodies and network failures', async () => {
    const answers = [
      () => json({ error: 'bad_request' }, 404),
      () => json({ ok: false }),
      () => new Response('not json'),
      () => {
        throw new TypeError('Failed to fetch');
      },
    ];
    for (const answer of answers) {
      const { fetchImpl } = fakeFetch(answer);
      const client = createApiClient({ baseUrl: 'https://api.test', accessKey: 'k', fetchImpl });
      expect(await client.health()).toBe(false);
    }
  });
});

describe('createApiClient().health with a stalled body', () => {
  it('gives up after timeoutMs', async () => {
    vi.useFakeTimers();
    const { fetchImpl } = fakeFetch((_url, init) => stalledBody(init, 200));
    const client = createApiClient({ baseUrl: 'https://api.test', accessKey: 'k', fetchImpl, timeoutMs: 5000 });

    let settled: boolean | undefined;
    const pending = client.health().then((ok) => (settled = ok));
    await vi.advanceTimersByTimeAsync(5000);
    await pending;

    expect(settled).toBe(false);
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds or an HTTP date and ignores anything else', () => {
    const now = Date.parse('2026-10-21T00:00:00Z');
    expect(parseRetryAfter('45', now)).toBe(45_000);
    expect(parseRetryAfter('0', now)).toBe(0);
    expect(parseRetryAfter('Wed, 21 Oct 2026 00:00:10 GMT', now)).toBe(10_000);
    expect(parseRetryAfter('Tue, 20 Oct 2026 00:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter('soon', now)).toBeUndefined();
  });
});
