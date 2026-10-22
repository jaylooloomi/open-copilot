import OpenAI, { type ClientOptions } from 'openai';
import { toUpstreamError } from './errors';
import { buildPrompt } from './prompt';
import type { Transcriber } from './types';

// 實作在 prompt.ts，與 Groq 共用；既有程式與測試從這裡匯入，所以重新匯出。
export { PROMPT_PREFIX, PROMPT_TAIL_CHARS, buildPrompt } from './prompt';

export const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';

/**
 * 單次上游呼叫的逾時（OpenAI 與 Groq 共用）。M3b 的 REQUEST_TIMEOUT_MS 是 30 秒（含上傳），
 * 伺服器的最壞情況必須比它短，前端才不會放棄一個伺服器其實會回應的請求。
 */
export const OPENAI_TIMEOUT_MS = 25_000;

/**
 * SDK 不重試（OpenAI 與 Groq 共用）：重試全部交給前端 withRetry（1s→2s→4s）。SDK 若再重試，
 * 一次前端請求會變成多次計費呼叫，最壞耗時也會超過前端逾時。
 */
export const OPENAI_MAX_RETRIES = 0;

/**
 * 固定的上游位址。SDK 預設會讀主機的 OPENAI_BASE_URL；若主機為別的工具設了它，
 * 使用者的音訊與 OpenAI 金鑰就會被默默送到那裡，所以這裡明確指定。
 */
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

export interface UpstreamClientOptions {
  /** 只給測試注入假上游；server.ts 從不傳入，一律使用 Node 內建的 fetch。 */
  fetch?: ClientOptions['fetch'];
}

export function createOpenAIClient(apiKey: string, options: UpstreamClientOptions = {}): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: OPENAI_BASE_URL,
    // 同理不吃主機的 OPENAI_ORG_ID / OPENAI_PROJECT_ID：設定只來自 README 列出的環境變數。
    organization: null,
    project: null,
    timeout: OPENAI_TIMEOUT_MS,
    maxRetries: OPENAI_MAX_RETRIES,
    fetch: options.fetch,
  });
}

export function createOpenAITranscriber(apiKey: string, client?: OpenAI): Transcriber {
  const openai = client ?? createOpenAIClient(apiKey);
  return {
    async transcribe({ file, prompt, signal }) {
      try {
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
      } catch (err) {
        // 上游 429 轉成 UpstreamRateLimitError，app.ts 才能回 429 並轉傳 Retry-After。
        throw toUpstreamError(err);
      }
    },
  };
}
