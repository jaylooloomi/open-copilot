import { useCallback, useSyncExternalStore } from 'react';

/** Read side of the microphone level, for components. */
export interface LevelSource {
  get(): number;
  /** Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export interface LevelStore extends LevelSource {
  set(level: number): void;
}

/**
 * The latest microphone level (RMS). Kept outside React state so that a new reading every ~100ms
 * re-renders only the level meter, not the whole app.
 */
export function createLevelStore(): LevelStore {
  let level = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => level,
    set: (next) => {
      // An RMS reading lies in 0..1; clamp so a meter never renders out of range.
      const value = Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : 0;
      if (value === level) return;
      level = value;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const NO_SOURCE: LevelSource = {
  get: () => 0,
  subscribe: () => () => undefined,
};

/** The current level of `source` (0 without one); re-renders when it changes. */
export function useLevel(source: LevelSource | undefined): number {
  const store = source ?? NO_SOURCE;
  // Call through the source so implementations whose methods use `this` keep their binding.
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const get = useCallback(() => store.get(), [store]);
  return useSyncExternalStore(subscribe, get, get);
}
