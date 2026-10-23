export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** Run the pending call now (no-op when nothing is pending). */
  flush(): void;
  /** Drop the pending call. */
  cancel(): void;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: A | undefined;

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    lastArgs = undefined;
  };

  // Reset state before calling fn, so a call made from inside fn schedules a new run
  // and an exception thrown by fn leaves nothing pending.
  const run = () => {
    const args = lastArgs;
    cancel();
    if (args) fn(...args);
  };

  const flush = () => {
    if (timer !== undefined) run();
  };

  const call = (...args: A) => {
    lastArgs = args;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(run, ms);
  };

  return Object.assign(call, { flush, cancel });
}
