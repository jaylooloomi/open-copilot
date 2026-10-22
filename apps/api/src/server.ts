import { writeSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { accessKeyWarning, loadConfig, type AppConfig } from './config';
import { createShutdown } from './shutdown';
import { createTranscriber } from './transcriber/createTranscriber';

/** 設定錯誤只印一行說明（訊息不含金鑰、不印 stack），並以 exit code 1 結束。 */
function loadConfigOrExit(): AppConfig {
  try {
    return loadConfig(process.env);
  } catch (err) {
    // 用同步寫入：stderr 是管線時 console.error 可能是非同步，process.exit 會截斷訊息。
    writeSync(2, `[config] ${err instanceof Error ? err.message : String(err)}
`);
    process.exit(1);
  }
}

const config = loadConfigOrExit();

const keyWarning = accessKeyWarning(config.accessKeys);
if (keyWarning) console.warn(keyWarning);

const app = createApp({
  transcriber: createTranscriber(config.transcriber),
  accessKeys: config.accessKeys,
  allowedOrigins: config.allowedOrigins,
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`open-copilot api listening on http://localhost:${info.port}`);
  // 只印服務與模型，不印金鑰。
  console.log(
    `[transcribe] provider ${config.transcriber.provider}, model ${config.transcriber.model}`,
  );
});

// Docker 中 node 是 PID 1，不處理 SIGTERM 的話 docker stop 會等 10 秒後強制終止。
const shutdown = createShutdown({ server });

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
