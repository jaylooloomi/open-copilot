/**
 * POST /ai/summary 與 POST /ai/todos 的 `text` 上限，以 Unicode 字元（code point）計算：
 * 後端用 Array.from(text).length，emoji 算 1 個字。超過時後端回 413 payload_too_large。
 */
export const AI_MAX_TEXT_CHARS = 60_000;

/** 後端單次 LLM 呼叫的逾時（不重試）。前端 AI 請求的逾時必須比這個長，才不會先放棄。 */
export const AI_UPSTREAM_TIMEOUT_MS = 60_000;

/** 兩個 AI 端點共用的 request body；title 可為空字串，text 不可只有空白。 */
export interface AiRequest {
  title: string;
  text: string;
}

/** POST /ai/summary 的成功回應；summary 為繁體中文。 */
export interface AiSummaryResponse {
  summary: string;
}

/** POST /ai/todos 的成功回應；items 為繁體中文，可為空陣列（筆記裡沒有待辦事項）。 */
export interface AiTodosResponse {
  items: string[];
}
