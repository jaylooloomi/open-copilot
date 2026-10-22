import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce } from './debounce';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls fn once, ms after the last call, with the last arguments', () => {
    const fn = vi.fn();
    const d = debounce(fn, 500);
    d('a');
    vi.advanceTimersByTime(300);
    d('b');
    vi.advanceTimersByTime(499);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('b');
  });

  it('flush() runs a pending call immediately and only once', () => {
    const fn = vi.fn();
    const d = debounce(fn, 500);
    d(1);
    d.flush();
    expect(fn).toHaveBeenCalledWith(1);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flush() does nothing when no call is pending', () => {
    const fn = vi.fn();
    const d = debounce(fn, 500);
    d.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel() drops a pending call', () => {
    const fn = vi.fn();
    const d = debounce(fn, 500);
    d(1);
    d.cancel();
    vi.advanceTimersByTime(1000);
    d.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('keeps working after flush() and cancel()', () => {
    const fn = vi.fn();
    const d = debounce(fn, 500);
    d(1);
    d.flush();
    d(2);
    vi.advanceTimersByTime(500);
    d(3);
    d.cancel();
    d(4);
    vi.advanceTimersByTime(500);
    expect(fn.mock.calls).toEqual([[1], [2], [4]]);
  });

  it('schedules a new call when fn calls the debounced function', () => {
    const calls: number[] = [];
    const d = debounce((n: number) => {
      calls.push(n);
      if (n === 1) d(2);
    }, 500);
    d(1);
    vi.advanceTimersByTime(500);
    expect(calls).toEqual([1]);
    vi.advanceTimersByTime(500);
    expect(calls).toEqual([1, 2]);
  });

  it('is ready for the next call after fn throws', () => {
    const fn = vi.fn((n: number) => {
      if (n === 1) throw new Error('boom');
    });
    const d = debounce(fn, 500);
    d(1);
    expect(() => d.flush()).toThrow('boom');
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    d(2);
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenLastCalledWith(2);
  });
});
