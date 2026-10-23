import { describe, expect, it, vi } from 'vitest';
import {
  LimiterQueueFullError,
  LimiterWaitTimeoutError,
  MAX_STDERR_CHARS,
  createLimiter,
  runProcess,
} from './processRunner';

const node = process.execPath;

describe('runProcess', () => {
  it('collects stdout as bytes, stderr as text and the exit code', async () => {
    const result = await runProcess(
      node,
      ['-e', 'process.stdout.write("\\u6703\\u8b70"); process.stderr.write("warn"); process.exit(3)'],
      { timeoutMs: 10_000 },
    );
    expect(result.code).toBe(3);
    expect(result.stdout.toString('utf8')).toBe('會議');
    expect(result.stderr).toBe('warn');
    expect(result.timedOut).toBe(false);
  });

  it('passes arguments verbatim, without a shell', async () => {
    const tricky = 'a b&c"d|e';
    const result = await runProcess(node, ['-e', 'process.stdout.write(process.argv[1])', tricky], {
      timeoutMs: 10_000,
    });
    expect(result.code).toBe(0);
    expect(result.stdout.toString('utf8')).toBe(tricky);
  });

  it('kills the process when the timeout passes', async () => {
    const started = Date.now();
    const result = await runProcess(node, ['-e', 'setTimeout(() => {}, 30000)'], { timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('kills the process when the signal aborts', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const result = await runProcess(node, ['-e', 'setTimeout(() => {}, 30000)'], {
      timeoutMs: 30_000,
      signal: controller.signal,
    });
    expect(result.code).toBeNull();
    expect(result.timedOut).toBe(false);
  });

  it('keeps only the first MAX_STDERR_CHARS characters of stderr', async () => {
    const result = await runProcess(
      node,
      ['-e', `process.stderr.write("x".repeat(${MAX_STDERR_CHARS * 3}))`],
      { timeoutMs: 10_000 },
    );
    expect(result.code).toBe(0);
    expect(result.stderr.length).toBe(MAX_STDERR_CHARS);
  });

  it('escalates to a hard kill when the process ignores the first kill', async () => {
    // POSIX 上第一次 kill 是 SIGTERM，這個子程序會忽略它；Windows 的 kill 本來就是強制結束。
    const started = Date.now();
    const result = await runProcess(
      node,
      ['-e', 'process.on("SIGTERM", () => {}); setTimeout(() => {}, 30000)'],
      { timeoutMs: 300 },
    );
    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
    expect(Date.now() - started).toBeLessThan(6000);
  }, 15_000);

  it('settles after a timeout even when a grandchild still holds the output pipes', async () => {
    // 子程序再開一個繼承 stdout/stderr 的孫程序，孫程序活得比逾時久，'close' 不會準時到。
    const script = [
      'const { spawn } = require("node:child_process");',
      'spawn(process.execPath, ["-e", "setTimeout(() => {}, 8000)"], { stdio: ["ignore", "inherit", "inherit"] });',
      'setTimeout(() => {}, 30000);',
    ].join(' ');
    const started = Date.now();
    const result = await runProcess(node, ['-e', script], { timeoutMs: 500 });
    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
    expect(Date.now() - started).toBeLessThan(6000);
  }, 15_000);

  it('does not start anything when the signal is already aborted', async () => {
    const result = await runProcess('oc-never-started', [], {
      timeoutMs: 1000,
      signal: AbortSignal.abort(),
    });
    expect(result).toEqual({ code: null, stdout: Buffer.alloc(0), stderr: '', timedOut: false });
  });

  it('rejects when the command cannot be started', async () => {
    await expect(
      runProcess('oc-no-such-command-for-tests', [], { timeoutMs: 5000 }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('createLimiter', () => {
  it('runs at most N tasks at once and starts queued tasks in order', async () => {
    const limit = createLimiter(2);
    const started: number[] = [];
    const finish: (() => void)[] = [];
    const task = (n: number) =>
      limit(
        () =>
          new Promise<number>((resolve) => {
            started.push(n);
            finish[n] = () => resolve(n);
          }),
      );

    const results = Promise.all([task(1), task(2), task(3)]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toEqual([1, 2]);

    finish[1]!();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toEqual([1, 2, 3]);

    finish[2]!();
    finish[3]!();
    await expect(results).resolves.toEqual([1, 2, 3]);
  });

  it('frees the slot when a task fails', async () => {
    const limit = createLimiter(1);
    await expect(limit(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limit(() => Promise.resolve('next'))).resolves.toBe('next');
  });

  it('refuses a task at once when the queue is full', async () => {
    const limit = createLimiter(1, { maxQueued: 1 });
    let finish: () => void = () => {};
    const running = limit(() => new Promise<void>((resolve) => (finish = resolve)));
    const queued = limit(() => Promise.resolve('queued'));
    await expect(limit(() => Promise.resolve('third'))).rejects.toBeInstanceOf(LimiterQueueFullError);
    finish();
    await running;
    await expect(queued).resolves.toBe('queued');
    // The queue has room again.
    await expect(limit(() => Promise.resolve('later'))).resolves.toBe('later');
  });

  it('drops a waiter as soon as its signal aborts, freeing its queue place', async () => {
    const limit = createLimiter(1, { maxQueued: 1 });
    let finish: () => void = () => {};
    const running = limit(() => new Promise<void>((resolve) => (finish = resolve)));
    const controller = new AbortController();
    const task = vi.fn(() => Promise.resolve('never'));
    const waiting = limit(task, { signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    // Its place in the queue is free before the running task ends.
    const next = limit(() => Promise.resolve('next'));
    finish();
    await running;
    await expect(next).resolves.toBe('next');
    expect(task).not.toHaveBeenCalled();
  });

  it('drops a waiter when its deadline passes, before the running task ends', async () => {
    const limit = createLimiter(1);
    let finish: () => void = () => {};
    const running = limit(() => new Promise<void>((resolve) => (finish = resolve)));
    const task = vi.fn(() => Promise.resolve('never'));
    const waiting = limit(task, { deadline: Date.now() + 30 });
    await expect(waiting).rejects.toBeInstanceOf(LimiterWaitTimeoutError);
    finish();
    await running;
    expect(task).not.toHaveBeenCalled();
    await expect(limit(() => Promise.resolve('next'))).resolves.toBe('next');
  });

  it('does not queue a task whose signal is already aborted', async () => {
    const limit = createLimiter(1);
    const task = vi.fn(() => Promise.resolve('never'));
    await expect(limit(task, { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(task).not.toHaveBeenCalled();
  });

  it('rejects a limit below 1', () => {
    expect(() => createLimiter(0)).toThrow(RangeError);
    expect(() => createLimiter(1.5)).toThrow(RangeError);
    expect(() => createLimiter(1, { maxQueued: -1 })).toThrow(RangeError);
  });
});
