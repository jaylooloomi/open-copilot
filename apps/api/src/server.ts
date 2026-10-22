import { serve } from '@hono/node-server';
import { createApp } from './app';
import { accessKeyWarning, loadConfig } from './config';
import { createShutdown } from './shutdown';
import { createTranscriber } from './transcriber/createTranscriber';

const config = loadConfig(process.env);

const keyWarning = accessKeyWarning(config.accessKeys);
if (keyWarning) console.warn(keyWarning);

const app = createApp({
  transcriber: createTranscriber(config.transcriber),
  accessKeys: config.accessKeys,
  allowedOrigins: config.allowedOrigins,
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`open-copilot api listening on http://localhost:${info.port}`);
});

// Docker 中 node 是 PID 1，不處理 SIGTERM 的話 docker stop 會等 10 秒後強制終止。
const shutdown = createShutdown({ server });

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
