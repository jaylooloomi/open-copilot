import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiInput } from './ai/types';
import { TEST_KEY, createFakeAssistant, createTestApp, type FakeAssistant } from './test/helpers';

/** 假 AI 助理：等到請求被取消才結束（模擬一個很慢、會計費的 LLM 呼叫）。 */
function createHangingAssistant() {
  let resolveCalled!: (signal: AbortSignal | undefined) => void;
  const called = new Promise<AbortSignal | undefined>((resolve) => {
    resolveCalled = resolve;
  });
  const hang = ({ signal }: AiInput) =>
    new Promise<never>((_resolve, reject) => {
      resolveCalled(signal);
      signal?.addEventListener('abort', () => reject(new Error('Request was aborted.')), {
        once: true,
      });
    });
  const assistant = createFakeAssistant();
  assistant.summarize.mockImplementation(hang);
  assistant.extractTodos.mockImplementation(hang);
  return { assistant, called };
}

// 只在 127.0.0.1 的臨時埠（port 0）上跑，不碰共用的 8787。
async function startServer(assistant: FakeAssistant) {
  const { app } = createTestApp({ assistant });
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

function post(port: number, path: string) {
  const body = Buffer.from(JSON.stringify({ title: '週會', text: '下週三前要寄出報價單。' }));
  const req = httpRequest({
    host: '127.0.0.1',
    port,
    method: 'POST',
    path,
    agent: false,
    headers: {
      Authorization: `Bearer ${TEST_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': body.length,
    },
  });
  const response = new Promise<{ status: number; body: string }>((resolve, reject) => {
    req.on('response', (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
    });
    req.on('error', reject);
  });
  req.end(body);
  return { req, response };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(['/ai/summary', '/ai/todos'] as const)('%s cancellation on a real node server', (path) => {
  it('cancels the upstream call when the client disconnects', async () => {
    const { assistant, called } = createHangingAssistant();
    const server = await startServer(assistant);
    try {
      const { req, response } = post(server.port, path);
      response.catch(() => {});

      const signal = await called;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(false);

      // 前端逾時或使用者離開頁面：連線在回應前被關掉。
      req.destroy();

      await vi.waitFor(() => expect(signal?.aborted).toBe(true), { timeout: 2_000 });
      const method = path === '/ai/summary' ? assistant.summarize : assistant.extractTodos;
      expect(method).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
  });

  it('keeps the signal alive through a normal response', async () => {
    const assistant = createFakeAssistant();
    const server = await startServer(assistant);
    try {
      const res = await post(server.port, path).response;
      expect(res.status).toBe(200);
      const method = path === '/ai/summary' ? assistant.summarize : assistant.extractTodos;
      expect(method.mock.calls[0]![0].signal?.aborted).toBe(false);
    } finally {
      await server.close();
    }
  });
});
