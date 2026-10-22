import OpenAI from 'openai';
import { toUpstreamError } from './errors';
import {
  OPENAI_MAX_RETRIES,
  OPENAI_TIMEOUT_MS,
  type UpstreamClientOptions,
} from './openaiTranscriber';
import { buildPrompt } from './prompt';
import type { Transcriber } from './types';

/**
 * Groq 的 OpenAI 相容端點。和 OPENAI_BASE_URL 一樣寫死，
 * 不讓主機上的 OPENAI_BASE_URL 把音訊與金鑰送到別處。
 */
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

/** 預設轉寫模型；可用 GROQ_TRANSCRIBE_MODEL 覆寫（見 config.ts）。 */
export const GROQ_DEFAULT_TRANSCRIBE_MODEL = 'whisper-large-v3-turbo';

export function createGroqClient(apiKey: string, options: UpstreamClientOptions = {}): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: GROQ_BASE_URL,
    // 不吃主機的 OPENAI_ORG_ID / OPENAI_PROJECT_ID：Groq 不認得，也可能洩漏別的工具的設定。
    organization: null,
    project: null,
    // 與 OpenAI 相同：單次嘗試、25 秒逾時，重試交給前端 withRetry。
    timeout: OPENAI_TIMEOUT_MS,
    maxRetries: OPENAI_MAX_RETRIES,
    fetch: options.fetch,
  });
}

export function createGroqTranscriber(
  apiKey: string,
  model: string = GROQ_DEFAULT_TRANSCRIBE_MODEL,
  client?: OpenAI,
): Transcriber {
  const groq = client ?? createGroqClient(apiKey);
  return {
    async transcribe({ file, prompt, signal }) {
      try {
        const result = await groq.audio.transcriptions.create(
          {
            file,
            model,
            language: 'zh',
            prompt: buildPrompt(prompt),
            response_format: 'json',
          },
          // 用戶端斷線時取消上游呼叫（契約變更 §8.5：每個轉寫服務都要轉交 signal）。
          { signal },
        );
        return result.text;
      } catch (err) {
        // Groq 免費額度用完時回 429：轉成 UpstreamRateLimitError，app.ts 回 429 並轉傳 Retry-After。
        throw toUpstreamError(err);
      }
    },
  };
}
