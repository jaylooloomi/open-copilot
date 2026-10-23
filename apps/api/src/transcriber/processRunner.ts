import { spawn } from 'node:child_process';

/** stderr 只保留這麼多字給錯誤訊息用，避免囉嗦的工具吃掉記憶體。 */
export const MAX_STDERR_CHARS = 4000;

export interface ProcessResult {
  /** 結束碼；因逾時或 abort 被 kill 時為 null。 */
  code: number | null;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
}

export interface RunOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

export type ProcessRunner = (
  command: string,
  args: readonly string[],
  options: RunOptions,
) => Promise<ProcessResult>;

/** 第一次 kill（POSIX 上是 SIGTERM）後等這麼久，程序還在就改送 SIGKILL。 */
export const KILL_GRACE_MS = 2000;

/** 程序結束後最多等這麼久讓 stdout/stderr 收尾；孫程序若還握著管線，就不再等它。 */
export const STREAM_DRAIN_MS = 1000;

/**
 * 不經 shell 執行外部程式（參數原樣傳入，不會被 cmd.exe 解析），收集輸出。
 * 超過 timeoutMs 或 signal abort 時 kill 掉程序（不理會就在 KILL_GRACE_MS 後強制結束），
 * promise 以 code null 結束；只有程式根本無法啟動（例如 ENOENT）時才 reject。
 */
export const runProcess: ProcessRunner = (command, args, { timeoutMs, signal }) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve({ code: null, stdout: Buffer.alloc(0), stderr: '', timedOut: false });
      return;
    }
    const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = '';
    let timedOut = false;
    let spawned = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let drainTimer: NodeJS.Timeout | undefined;
    const running = () => child.exitCode === null && child.signalCode === null;
    const kill = () => {
      if (!running() || killTimer) return;
      child.kill();
      killTimer = setTimeout(() => {
        if (running()) child.kill('SIGKILL');
      }, KILL_GRACE_MS);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    signal?.addEventListener('abort', kill, { once: true });
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(drainTimer);
      signal?.removeEventListener('abort', kill);
    };
    const finish = (code: number | null) => {
      if (settled) return;
      cleanup();
      resolve({ code, stdout: Buffer.concat(chunks), stderr, timedOut });
    };
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < MAX_STDERR_CHARS) stderr = (stderr + chunk).slice(0, MAX_STDERR_CHARS);
    });
    child.once('spawn', () => {
      spawned = true;
    });
    child.on('error', (err) => {
      // 啟動成功後的錯誤（例如 kill 失敗）不結束 promise，結果仍由 'exit'/'close' 決定。
      if (spawned || settled) return;
      cleanup();
      reject(err);
    });
    child.once('exit', (code) => {
      clearTimeout(killTimer);
      drainTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish(code);
      }, STREAM_DRAIN_MS);
    });
    child.once('close', (code) => finish(code));
  });

export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

/** 最多同時執行 maxConcurrent 個 task，其餘依呼叫順序排隊。 */
export function createLimiter(maxConcurrent: number): Limiter {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new RangeError(`maxConcurrent must be an integer >= 1, got ${maxConcurrent}`);
  }
  let active = 0;
  const waiting: (() => void)[] = [];
  const acquire = (): Promise<void> => {
    if (active < maxConcurrent) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve));
  };
  // 有人排隊時直接把名額交給下一個，active 不變。
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
}
