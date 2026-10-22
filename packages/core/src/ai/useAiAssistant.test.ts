import type { AiRequest, AiSummaryResponse, AiTodosResponse } from '@oc/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/apiClient';
import type { Settings } from '../settings/settingsStore';
import { AI_MESSAGES } from './aiMessages';
import { useAiAssistant, type AiAssistantDeps } from './useAiAssistant';

const SETTINGS: Settings = { apiBaseUrl: 'https://api.test', accessKey: 'key-1' };
const INPUT: AiRequest = { title: '週會', text: '下週三前寄出報價單' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeDeps({ acknowledged = true } = {}) {
  let ack = acknowledged;
  const summarize = vi.fn<(input: AiRequest) => Promise<AiSummaryResponse>>();
  const todos = vi.fn<(input: AiRequest) => Promise<AiTodosResponse>>();
  const createClient = vi.fn((_settings: Settings) => ({ summarize, todos }));
  const privacy = {
    isAcknowledged: vi.fn(() => ack),
    acknowledge: vi.fn(() => {
      ack = true;
    }),
  };
  const deps: AiAssistantDeps = { createClient, privacy };
  return { deps, summarize, todos, createClient, privacy };
}

function setup(f: ReturnType<typeof fakeDeps>, onUnauthorized = vi.fn()) {
  const view = renderHook(() => useAiAssistant({ settings: SETTINGS, onUnauthorized, deps: f.deps }));
  return { ...view, onUnauthorized };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAiAssistant', () => {
  it('shows loading, then the summary', async () => {
    const f = fakeDeps();
    const call = deferred<AiSummaryResponse>();
    f.summarize.mockReturnValueOnce(call.promise);
    const { result } = setup(f);

    act(() => result.current.request('summary', INPUT));

    expect(result.current.panel).toMatchObject({ kind: 'summary', status: 'loading' });
    expect(f.createClient).toHaveBeenCalledWith(SETTINGS);
    expect(f.summarize).toHaveBeenCalledWith(INPUT);
    await act(async () => call.resolve({ summary: '決定寄出報價單' }));
    expect(result.current.panel).toMatchObject({ kind: 'summary', status: 'done', summary: '決定寄出報價單' });
  });

  it('shows the todo items', async () => {
    const f = fakeDeps();
    f.todos.mockResolvedValueOnce({ items: ['寄出報價單'] });
    const { result } = setup(f);

    await act(async () => result.current.request('todos', INPUT));

    expect(result.current.panel).toMatchObject({ kind: 'todos', status: 'done', items: ['寄出報價單'] });
  });

  it('asks for the privacy notice before the first request and sends it once accepted', async () => {
    const f = fakeDeps({ acknowledged: false });
    f.summarize.mockResolvedValueOnce({ summary: '摘要' });
    const { result } = setup(f);

    act(() => result.current.request('summary', INPUT));
    expect(result.current.privacyPending).toBe(true);
    expect(result.current.panel).toBeNull();
    expect(f.summarize).not.toHaveBeenCalled();

    await act(async () => result.current.acceptPrivacy());

    expect(f.privacy.acknowledge).toHaveBeenCalledTimes(1);
    expect(result.current.privacyPending).toBe(false);
    expect(f.summarize).toHaveBeenCalledWith(INPUT);
    expect(result.current.panel).toMatchObject({ status: 'done', summary: '摘要' });
  });

  it('drops the request when the privacy notice is cancelled', () => {
    const f = fakeDeps({ acknowledged: false });
    const { result } = setup(f);

    act(() => result.current.request('todos', INPUT));
    act(() => result.current.cancelPrivacy());

    expect(result.current.privacyPending).toBe(false);
    expect(f.privacy.acknowledge).not.toHaveBeenCalled();
    expect(f.todos).not.toHaveBeenCalled();
    expect(result.current.panel).toBeNull();
  });

  it('shows the error message and retries the same request', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const f = fakeDeps();
    f.summarize
      .mockRejectedValueOnce(new ApiError('x', 503, { code: 'ai_unavailable' }))
      .mockResolvedValueOnce({ summary: '摘要' });
    const { result, onUnauthorized } = setup(f);

    await act(async () => result.current.request('summary', INPUT));
    expect(result.current.panel).toMatchObject({ kind: 'summary', status: 'error', message: AI_MESSAGES.unavailable });
    expect(onUnauthorized).not.toHaveBeenCalled();

    await act(async () => result.current.retry());
    expect(f.summarize).toHaveBeenCalledTimes(2);
    expect(f.summarize).toHaveBeenLastCalledWith(INPUT);
    expect(result.current.panel).toMatchObject({ status: 'done', summary: '摘要' });
  });

  it('calls onUnauthorized for a rejected access key', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const f = fakeDeps();
    f.todos.mockRejectedValueOnce(new ApiError('x', 401, { code: 'unauthorized' }));
    const { result, onUnauthorized } = setup(f);

    await act(async () => result.current.request('todos', INPUT));

    expect(result.current.panel).toMatchObject({ status: 'error', message: AI_MESSAGES.unauthorized });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('ignores a response that arrives after the panel was closed', async () => {
    const f = fakeDeps();
    const call = deferred<AiSummaryResponse>();
    f.summarize.mockReturnValueOnce(call.promise);
    const { result } = setup(f);

    act(() => result.current.request('summary', INPUT));
    act(() => result.current.close());
    await act(async () => call.resolve({ summary: '太晚了' }));

    expect(result.current.panel).toBeNull();
  });

  it('shows only the latest of two overlapping requests', async () => {
    const f = fakeDeps();
    const first = deferred<AiSummaryResponse>();
    f.summarize.mockReturnValueOnce(first.promise);
    f.todos.mockResolvedValueOnce({ items: ['寄出報價單'] });
    const { result } = setup(f);

    act(() => result.current.request('summary', INPUT));
    await act(async () => result.current.request('todos', INPUT));
    await act(async () => first.resolve({ summary: '舊的' }));

    expect(result.current.panel).toMatchObject({ kind: 'todos', status: 'done' });
  });

  it('keeps close() the same function across renders', () => {
    const f = fakeDeps();
    const { result, rerender } = setup(f);
    const close = result.current.close;
    rerender();
    expect(result.current.close).toBe(close);
  });
});
