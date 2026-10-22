import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createLevelStore, useLevel, type LevelSource } from './levelStore';

describe('createLevelStore', () => {
  it('starts at 0 and keeps the last level', () => {
    const store = createLevelStore();
    expect(store.get()).toBe(0);
    store.set(0.25);
    expect(store.get()).toBe(0.25);
  });

  it('notifies subscribers only when the level changes', () => {
    const store = createLevelStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(0.1);
    store.set(0.1);
    store.set(0.2);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stores a NaN or infinite reading as 0', () => {
    const store = createLevelStore();
    store.set(0.4);
    store.set(Number.NaN);
    expect(store.get()).toBe(0);
    store.set(Number.POSITIVE_INFINITY);
    expect(store.get()).toBe(0);
  });

  it('clamps a reading to the 0..1 range', () => {
    const store = createLevelStore();
    store.set(-0.2);
    expect(store.get()).toBe(0);
    store.set(1.7);
    expect(store.get()).toBe(1);
  });

  it('stops notifying after unsubscribing', () => {
    const store = createLevelStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set(0.3);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('useLevel', () => {
  it('re-renders with the latest level', () => {
    const store = createLevelStore();
    const { result } = renderHook(() => useLevel(store));
    expect(result.current).toBe(0);
    act(() => store.set(0.3));
    expect(result.current).toBe(0.3);
  });

  it('works with a class-based source whose methods use this', () => {
    class ClassSource implements LevelSource {
      private level = 0;
      private readonly listeners = new Set<() => void>();
      get(): number {
        return this.level;
      }
      subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      }
      push(level: number): void {
        this.level = level;
        for (const listener of this.listeners) listener();
      }
    }
    const source = new ClassSource();
    const { result } = renderHook(() => useLevel(source));
    expect(result.current).toBe(0);
    act(() => source.push(0.6));
    expect(result.current).toBe(0.6);
  });

  it('reads 0 without a store', () => {
    const { result } = renderHook(() => useLevel(undefined));
    expect(result.current).toBe(0);
  });
});
