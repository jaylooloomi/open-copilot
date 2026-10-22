import { useSyncExternalStore } from 'react';

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
      const value = Number.isFinite(next) ? next : 0;
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
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
