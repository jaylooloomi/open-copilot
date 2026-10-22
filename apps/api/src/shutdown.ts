/**
 * 收到 SIGTERM 後的強制結束期限。Docker 預設等 10 秒就送 SIGKILL，進行中的轉寫（OPENAI_TIMEOUT_MS 為 25 秒）
 * 或慢速上傳會讓 server.close() 一直等下去，所以要在 Docker 動手前自行結束。
 */
export const SHUTDOWN_TIMEOUT_MS = 8_000;

export interface ClosableServer {
  close(callback?: (err?: Error) => void): unknown;
}

export interface ShutdownDeps {
  server: ClosableServer;
  exit?: (code: number) => void;
  timeoutMs?: number;
}

/** 回傳訊號處理函式：停止接受新連線，等進行中的請求結束後 exit 0；關閉出錯或超過期限則 exit 1。 */
export function createShutdown({
  server,
  exit = (code) => process.exit(code),
  timeoutMs = SHUTDOWN_TIMEOUT_MS,
}: ShutdownDeps) {
  return (signal: string) => {
    console.log(`${signal} received, closing server`);
    const deadline = setTimeout(() => {
      console.error(`server did not close within ${timeoutMs} ms, forcing exit`);
      exit(1);
    }, timeoutMs);
    // 計時器本身不該讓行程多活；伺服器關好後事件迴圈清空即可結束。
    deadline.unref();
    server.close((err) => {
      clearTimeout(deadline);
      if (err) console.error('[api] server close error:', err.message);
      exit(err ? 1 : 0);
    });
  };
}
