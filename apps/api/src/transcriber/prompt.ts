/** 引導模型輸出繁體中文的固定前綴；不計入 PROMPT_TAIL_CHARS。 */
export const PROMPT_PREFIX = '以下是繁體中文的語音內容。';

/**
 * Whisper 系列的 prompt 上限是 224 tokens。前端照樣送前一段的最後 200 字，
 * 由後端只保留最後 80 個字（以 Unicode 字元計，不切開代理對）。
 */
export const PROMPT_TAIL_CHARS = 80;

export function buildPrompt(previousText: string): string {
  const chars = Array.from(previousText.trim());
  const tail = chars.slice(-PROMPT_TAIL_CHARS).join('').trimStart();
  return tail ? `${PROMPT_PREFIX}${tail}` : PROMPT_PREFIX;
}
