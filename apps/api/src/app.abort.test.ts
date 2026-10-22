import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transcriber } from './transcriber/types';
import {
  TEST_KEY,
  createTestApp,
  postTranscribe,
  transcribeForm,
  type FakeTranscriber,
} from './test/helpers';

/** 假轉寫服務：等到請求被取消才結束（模擬一個很慢、會計費的上游呼叫）。 */
function createHangingTranscriber() {
  let resolveCalled!: (signal: AbortSignal | undefined) => void;
  const called = new Promise<AbortSignal | undefined>((resolve) => {
    resolveCalled = resolve;
  });
  const transcribe = vi.fn<Transcriber['transcribe']>(
    ({ signal }) =>
      new Promise<string>((_resolve, reject) => {
        resolveCalled(signal);
        signal?.addEventListener('abort', () => reject(new Error('Request was aborted.')), {
          once: true,
        });
      }),
  );
  return { transcriber: { transcribe }, called };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /transcribe cancellation', () => {
  it('passes the request signal to the transcriber', async () => {
    const { transcriber, called } = createHangingTranscriber();
    const { app } = createTestApp({ transcriber });
    const controller = new AbortController();

    const pending = app.request('/transcribe', {
      method: 'POST',
      body: transcribeForm(),
      headers: { Authorization: `Bearer ${TEST_KEY}` },
      signal: controller.signal,
    });

    const signal = await called;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(false);

    controller.abort();
    expect(signal!.aborted).toBe(true);
    const res = await pending;
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream_error' });
    // 斷線不是上游故障，不該記成 upstream error。
    expect(console.warn).toHaveBeenCalledWith(
      '[transcribe] client disconnected; upstream call cancelled',
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  it('does not abort the signal of a request that completes normally', async () => {
    const { app, transcriber } = createTestApp();
    const res = await postTranscribe(app, transcribeForm());
    expect(res.status).toBe(200);
    expect(transcriber.transcribe.mock.calls[0]![0].signal?.aborted).toBe(false);
  });
});

describe('POST /transcribe cancellation on a real node server', () => {
  // 只在 127.0.0.1 的臨時埠（port 0）上跑，不碰共用的 8787。
  async function startServer(transcriber: FakeTranscriber) {
    const { app } = createTestApp({ transcriber });
    const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
    await new Promise<void>((resolve) => {
      if (server.listening) resolve();
      else server.once('listening', () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    const close = () =>
      new Promise<void>((resolve) => {
        if ('closeAllConnections' in server) server.closeAllConnections();
        server.close(() => resolve());
      });
    return { port, close };
  }

  async function encodeForm() {
    const encoded = new Response(transcribeForm());
    return {
      contentType: encoded.headers.get('Content-Type')!,
      body: Buffer.from(await encoded.arrayBuffer()),
    };
  }

  function post(port: number, form: { contentType: string; body: Buffer }) {
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/transcribe',
      agent: false,
      headers: {
        Authorization: `Bearer ${TEST_KEY}`,
        'Content-Type': form.contentType,
        'Content-Length': form.body.length,
      },
    });
    const response = new Promise<{ status: number; body: string }>((resolve, reject) => {
      req.on('response', (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on('error', reject);
    });
    req.end(form.body);
    return { req, response };
  }

  it('cancels the upstream call when the client disconnects', async () => {
    const { transcriber, called } = createHangingTranscriber();
    const server = await startServer(transcriber);
    try {
      const { req, response } = post(server.port, await encodeForm());
      response.catch(() => {});

      const signal = await called;
      expect(signal?.aborted).toBe(false);

      // 前端逾時（M3b 30 秒）或使用者離開頁面：連線在回應前被關掉。
      req.destroy();

      await vi.waitFor(() => expect(signal?.aborted).toBe(true), { timeout: 2_000 });
      expect(transcriber.transcribe).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
  });

  it('keeps the signal alive through a normal response', async () => {
    let received: AbortSignal | undefined;
    const transcribe = vi.fn<Transcriber['transcribe']>(async ({ signal }) => {
      received = signal;
      return '你好';
    });
    const server = await startServer({ transcribe });
    try {
      const { response } = post(server.port, await encodeForm());
      const res = await response;
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ seq: 1, text: '你好' });
      expect(received).toBeInstanceOf(AbortSignal);
      expect(received!.aborted).toBe(false);
    } finally {
      await server.close();
    }
  });
});
