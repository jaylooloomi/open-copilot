import OpenAI from 'openai';
import type { Transcriber } from './types';

export const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
export const PROMPT_PREFIX = '以下是繁體中文的語音內容。';

/**
 * 單次 OpenAI 呼叫的逾時。M3b 的 REQUEST_TIMEOUT_MS 是 30 秒（含上傳），
 * 伺服器的最壞情況必須比它短，前端才不會放棄一個伺服器其實會回應的請求。
 */
export const OPENAI_TIMEOUT_MS = 25_000;

/**
 * SDK 不重試：重試全部交給前端 withRetry（1s→2s→4s）。SDK 若再重試，
 * 一次前端請求會變成多次計費呼叫，最壞耗時也會超過前端逾時。
 */
export const OPENAI_MAX_RETRIES = 0;

export function buildPrompt(previousText: string): string {
  const trimmed = previousText.trim();
  return trimmed ? `${PROMPT_PREFIX}${trimmed}` : PROMPT_PREFIX;
}

/**
 * 固定的上游位址。SDK 預設會讀主機的 OPENAI_BASE_URL；若主機為別的工具設了它，
 * 使用者的音訊與 OpenAI 金鑰就會被默默送到那裡，所以這裡明確指定。
 */
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

export function createOpenAIClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: OPENAI_BASE_URL,
    // 同理不吃主機的 OPENAI_ORG_ID / OPENAI_PROJECT_ID：設定只來自 README 列出的環境變數。
    organization: null,
    project: null,
    timeout: OPENAI_TIMEOUT_MS,
    maxRetries: OPENAI_MAX_RETRIES,
  });
}

export function createOpenAITranscriber(apiKey: string, client?: OpenAI): Transcriber {
  const openai = client ?? createOpenAIClient(apiKey);
  return {
    async transcribe({ file, prompt, signal }) {
      const result = await openai.audio.transcriptions.create(
        {
          file,
          model: TRANSCRIBE_MODEL,
          language: 'zh',
          prompt: buildPrompt(prompt),
          response_format: 'json',
        },
        // 用戶端斷線時取消上游呼叫，不讓已被放棄的請求繼續計費、和前端重試疊在一起。
        { signal },
      );
      return result.text;
    },
  };
}
