import { AI_MAX_TEXT_CHARS, type AiRequest } from '@oc/shared';

/** parseAiRequest 不接受時，app.ts 要回的錯誤碼：400 bad_request 或 413 payload_too_large。 */
export type AiRequestError = 'bad_request' | 'payload_too_large';

/** 以 Unicode 字元（code point）計數；String#length 會把 emoji 這類代理對算成 2。 */
export function countChars(text: string): number {
  return Array.from(text).length;
}

/**
 * 驗證 /ai/summary、/ai/todos 的 JSON body：title、text 都必須是字串，title 可為空字串；
 * text 只有空白時回 bad_request；超過 AI_MAX_TEXT_CHARS 個字時回 payload_too_large。
 * 成功時只回傳 title 與 text（不帶多餘欄位），原樣不修剪。
 */
export function parseAiRequest(raw: unknown): AiRequest | AiRequestError {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'bad_request';
  const { title, text } = raw as Record<string, unknown>;
  if (typeof title !== 'string' || typeof text !== 'string') return 'bad_request';
  if (text.trim() === '') return 'bad_request';
  if (countChars(text) > AI_MAX_TEXT_CHARS) return 'payload_too_large';
  return { title, text };
}
