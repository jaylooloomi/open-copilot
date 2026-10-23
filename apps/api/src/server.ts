import { writeSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { createGroqAssistant } from './ai/groqAssistant';
import { createApp } from './app';
import { accessKeyWarning, loadConfig, type AppConfig } from './config';
import { createShutdown } from './shutdown';
import { createTranscriber } from './transcriber/createTranscriber';
import { findFfmpegProblem } from './transcriber/windowsTranscriber';

/** 設定錯誤只印一行說明（訊息不含金鑰、不印 stack），並以 exit code 1 結束。 */
function exitWithConfigError(message: string): never {
  // 用同步寫入：stderr 是管線時 console.error 可能是非同步，process.exit 會截斷訊息。
  writeSync(2, `[config] ${message}\n`);
  process.exit(1);
}

/** 讀取設定；設定錯誤時印一行說明並以 exit code 1 結束。 */
function loadConfigOrExit(): AppConfig {
  try {
    return loadConfig(process.env);
  } catch (err) {
    return exitWithConfigError(err instanceof Error ? err.message : String(err));
  }
}

const config = loadConfigOrExit();

// windows provider 每段都靠 ffmpeg 轉檔：找不到就立刻停下，不要等到第一段錄音才回 502。
if (config.transcriber.provider === 'windows') {
  const problem = findFfmpegProblem(config.transcriber.ffmpegPath);
  if (problem) exitWithConfigError(problem);
}

const keyWarning = accessKeyWarning(config.accessKeys);
if (keyWarning) console.warn(keyWarning);

const app = createApp({
  transcriber: createTranscriber(config.transcriber),
  // 沒有 GROQ_API_KEY 時不建 AI 助理，/ai/* 回 503 ai_unavailable。
  assistant: config.ai ? createGroqAssistant(config.ai.apiKey, config.ai.model) : null,
  accessKeys: config.accessKeys,
  allowedOrigins: config.allowedOrigins,
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`open-copilot api listening on http://localhost:${info.port}`);
  // 只印服務與模型，不印金鑰。
  console.log(
    `[transcribe] provider ${config.transcriber.provider}, model ${config.transcriber.model}`,
  );
  if (config.transcriber.provider === 'windows') {
    console.log(
      '[transcribe] Windows built-in offline recognition: no punctuation and lower accuracy; set GROQ_API_KEY for better results',
    );
  }
  console.log(
    config.ai
      ? `[ai] provider groq, model ${config.ai.model}`
      : '[ai] disabled: set GROQ_API_KEY to enable /ai/summary and /ai/todos',
  );
});

// Docker 中 node 是 PID 1，不處理 SIGTERM 的話 docker stop 會等 10 秒後強制終止。
const shutdown = createShutdown({ server });

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
