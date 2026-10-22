/** 一次 AI 請求的輸入：已通過 parseAiRequest 驗證的 title、text，加上用戶端斷線時會 abort 的 signal。 */
export interface AiInput {
  title: string;
  text: string;
  signal?: AbortSignal;
}

/**
 * AI 摘要與待辦事項。實作必須把 signal 轉給上游呼叫，並用 toUpstreamError 把上游 429 轉成
 * UpstreamRateLimitError；輸出不合格式時丟 AiOutputError。回傳的文字還沒轉繁體，由 app.ts 處理。
 */
export interface NoteAssistant {
  summarize(input: AiInput): Promise<string>;
  extractTodos(input: AiInput): Promise<string[]>;
}

/** loadConfig 產生的 AI 設定；沒有 GROQ_API_KEY 時整個設定為 null。 */
export interface AiConfig {
  apiKey: string;
  model: string;
}
