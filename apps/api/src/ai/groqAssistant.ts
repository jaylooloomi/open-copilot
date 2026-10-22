import { AI_UPSTREAM_TIMEOUT_MS } from '@oc/shared';
import OpenAI from 'openai';
import { toUpstreamError } from '../transcriber/errors';
import { GROQ_BASE_URL } from '../transcriber/groqTranscriber';
import { OPENAI_MAX_RETRIES, type UpstreamClientOptions } from '../transcriber/openaiTranscriber';
import { normalizeSummary, parseTodoItems } from './output';
import { buildUserMessage, SUMMARY_SYSTEM_PROMPT, TODOS_SYSTEM_PROMPT } from './prompts';
import type { AiInput, NoteAssistant } from './types';

/** 預設 LLM；可用 GROQ_LLM_MODEL 覆寫（見 config.ts）。 */
export const GROQ_DEFAULT_LLM_MODEL = 'openai/gpt-oss-120b';

/**
 * AI 專用的 Groq client：和轉寫一樣寫死 baseURL、不吃主機的 OPENAI_ORG_ID／OPENAI_PROJECT_ID、SDK 不重試；
 * 逾時改用 AI_UPSTREAM_TIMEOUT_MS（長筆記的 LLM 回應比一段音訊的轉寫慢）。
 */
export function createGroqLlmClient(apiKey: string, options: UpstreamClientOptions = {}): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: GROQ_BASE_URL,
    organization: null,
    project: null,
    timeout: AI_UPSTREAM_TIMEOUT_MS,
    maxRetries: OPENAI_MAX_RETRIES,
    fetch: options.fetch,
  });
}

/**
 * apiKey 只在沒有注入 client 時使用；測試注入 client 時會被忽略（與 createGroqTranscriber 相同）。
 * 不送 reasoning_effort、temperature 這類只有部分模型支援的參數，GROQ_LLM_MODEL 換成別的模型也能用。
 */
export function createGroqAssistant(
  apiKey: string,
  model: string = GROQ_DEFAULT_LLM_MODEL,
  client?: OpenAI,
): NoteAssistant {
  const groq = client ?? createGroqLlmClient(apiKey);

  async function complete(
    systemPrompt: string,
    { title, text, signal }: AiInput,
    jsonMode: boolean,
  ): Promise<string | null | undefined> {
    const body: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildUserMessage(title, text) },
      ],
    };
    if (jsonMode) body.response_format = { type: 'json_object' };
    try {
      // 用戶端斷線時取消上游呼叫，不讓已被放棄的請求繼續計費。
      const completion = await groq.chat.completions.create(body, { signal });
      return completion.choices[0]?.message.content;
    } catch (err) {
      // Groq 限流時回 429：轉成 UpstreamRateLimitError，app.ts 回 429 並轉傳 Retry-After。
      throw toUpstreamError(err);
    }
  }

  return {
    async summarize(input) {
      return normalizeSummary(await complete(SUMMARY_SYSTEM_PROMPT, input, false));
    },
    async extractTodos(input) {
      return parseTodoItems(await complete(TODOS_SYSTEM_PROMPT, input, true));
    },
  };
}
