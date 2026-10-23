import { describe, expect, it } from 'vitest';
import { createLimiter, runProcess } from './processRunner';

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

  it('rejects a limit below 1', () => {
    expect(() => createLimiter(0)).toThrow(RangeError);
    expect(() => createLimiter(1.5)).toThrow(RangeError);
  });
});
