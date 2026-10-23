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

/**
 * 不經 shell 執行外部程式（參數原樣傳入，不會被 cmd.exe 解析），收集輸出。
 * 超過 timeoutMs 或 signal abort 時 kill 掉程序，promise 以 code null 結束；
 * 只有程式根本無法啟動（例如 ENOENT）時才 reject。
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
    const kill = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    signal?.addEventListener('abort', kill, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', kill);
    };
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < MAX_STDERR_CHARS) stderr = (stderr + chunk).slice(0, MAX_STDERR_CHARS);
    });
    child.once('error', (err) => {
      cleanup();
      reject(err);
    });
    child.once('close', (code) => {
      cleanup();
      resolve({ code, stdout: Buffer.concat(chunks), stderr, timedOut });
    });
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
