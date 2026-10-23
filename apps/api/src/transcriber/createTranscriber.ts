import { createGroqClient, createGroqTranscriber } from './groqTranscriber';
import {
  createOpenAIClient,
  createOpenAITranscriber,
  TRANSCRIBE_MODEL,
  type UpstreamClientOptions,
} from './openaiTranscriber';
import type { Transcriber } from './types';
import { createWindowsTranscriber } from './windowsTranscriber';

export type TranscribeProvider = 'groq' | 'openai' | 'windows';

/**
 * loadConfig 產生的轉寫服務設定；model 一律是實際使用的模型名稱（windows 為 'System.Speech zh-TW'）。
 * config.ts 應從這裡匯入 TranscriberConfig／TranscribeProvider，不要重複宣告。
 */
export type TranscriberConfig =
  | { provider: 'groq' | 'openai'; apiKey: string; model: string }
  | { provider: 'windows'; model: string; ffmpegPath: string };

/** 依設定建出轉寫服務。options.fetch 只給測試注入假上游，server.ts 不傳。 */
export function createTranscriber(
  config: TranscriberConfig,
  options: UpstreamClientOptions = {},
): Transcriber {
  switch (config.provider) {
    case 'groq':
      return createGroqTranscriber(
        config.apiKey,
        config.model,
        createGroqClient(config.apiKey, options),
      );
    case 'openai':
      // OpenAI 固定用 TRANSCRIBE_MODEL；config.model 只供啟動訊息顯示，不同就擋下，免得覆寫被默默忽略。
      if (config.model !== TRANSCRIBE_MODEL) {
        throw new Error(
          `OpenAI transcription always uses ${TRANSCRIBE_MODEL}; got model "${config.model}"`,
        );
      }
      return createOpenAITranscriber(config.apiKey, createOpenAIClient(config.apiKey, options));
    case 'windows':
      // 離線辨識不連網，options.fetch 用不到。
      return createWindowsTranscriber({ ffmpegPath: config.ffmpegPath });
    default: {
      const unknownProvider: never = config;
      throw new Error(`Unknown transcribe provider: ${String((unknownProvider as { provider: unknown }).provider)}`);
    }
  }
}
