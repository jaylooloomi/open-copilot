/** /ai/todos 最多回傳的項目數；模型多給的直接截掉。 */
export const MAX_TODO_ITEMS = 50;

/**
 * LLM 回應不符合預期格式（空白、不是 JSON、schema 不對）。app.ts 當成上游錯誤回 502 upstream_error。
 * 訊息只描述哪裡不對，不含模型輸出，避免筆記內容進到伺服器紀錄。
 */
export class AiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiOutputError';
  }
}

// 開頭的清單符號與勾選框：「- 」「* 」「• 」「1. 」「1) 」「1、」以及「[ ]」「[x]」「☐」「☑」。
// 符號與數字後面必須接空白或結尾（「、」除外），所以「2026.10.30 前交報告」不會被誤刪，只有符號的項目會被丟掉。
const LIST_MARKER = /^(?:[-*•](?:\s+|$)|\d+(?:[.)](?:\s+|$)|、\s*))?(?:\[[ xX]?\]\s*|[☐☑]\s*)?/;

// 會被直接刪掉的控制字元：C0（換行、Tab 這類空白除外，它們下面會被併成一個空白）與 DEL。
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000E-\u001F\u007F]/g;

/** /ai/summary 的模型輸出：去掉頭尾空白；空白或沒有內容時丟 AiOutputError。 */
export function normalizeSummary(content: string | null | undefined): string {
  const summary = content?.trim() ?? '';
  if (summary === '') throw new AiOutputError('LLM returned an empty summary');
  return summary;
}

/**
 * /ai/todos 的模型輸出（JSON 模式）：必須是 {"items": string[]}。
 * 每項刪掉控制字元、把內部的連續空白（含換行）併成一個空白，讓一項永遠只佔一行（前端寫成 task item、匯出 Markdown 才不會斷開），
 * 再去掉頭尾空白與開頭的清單符號，略過空白與重複項目，最多 MAX_TODO_ITEMS 項。
 */
export function parseTodoItems(content: string | null | undefined): string[] {
  if (content == null || content.trim() === '') {
    throw new AiOutputError('LLM returned no content');
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new AiOutputError('LLM returned invalid JSON');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new AiOutputError('LLM JSON is not an object');
  }

  const items = (data as Record<string, unknown>)['items'];
  if (!Array.isArray(items)) {
    throw new AiOutputError('LLM JSON has no "items" array');
  }

  const result: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') {
      throw new AiOutputError('LLM "items" must be strings');
    }
    const cleaned = item
      .replace(CONTROL_CHARS, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(LIST_MARKER, '')
      .trim();
    if (cleaned !== '' && !result.includes(cleaned)) result.push(cleaned);
    if (result.length === MAX_TODO_ITEMS) break;
  }
  return result;
}
