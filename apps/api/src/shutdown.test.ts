import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHUTDOWN_TIMEOUT_MS, createShutdown } from './shutdown';

function fakeServer() {
  let onClosed: ((err?: Error) => void) | undefined;
  return {
    close: vi.fn((callback?: (err?: Error) => void) => {
      onClosed = callback;
    }),
    finishClosing: (err?: Error) => onClosed?.(err),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createShutdown', () => {
  it('stays under the 10 s Docker stop grace period', () => {
    expect(SHUTDOWN_TIMEOUT_MS).toBeLessThan(10_000);
  });

  it('exits 0 once the server has closed', () => {
    const server = fakeServer();
    const exit = vi.fn();
    createShutdown({ server, exit })('SIGTERM');

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();

    server.finishClosing();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);

    vi.advanceTimersByTime(SHUTDOWN_TIMEOUT_MS);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('exits 1 when close reports an error', () => {
    const server = fakeServer();
    const exit = vi.fn();
    createShutdown({ server, exit })('SIGINT');

    server.finishClosing(new Error('ERR_SERVER_NOT_RUNNING'));
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('forces exit 1 when in-flight requests keep the server open past the deadline', () => {
    const server = fakeServer();
    const exit = vi.fn();
    createShutdown({ server, exit, timeoutMs: 500 })('SIGTERM');

    vi.advanceTimersByTime(499);
    expect(exit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
