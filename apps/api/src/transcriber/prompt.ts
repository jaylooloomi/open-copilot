/** 引導模型輸出繁體中文的固定前綴；不計入 PROMPT_TAIL_CHARS。 */
export const PROMPT_PREFIX = '以下是繁體中文的語音內容。';

/**
 * 所有供應商（Groq Whisper、OpenAI gpt-4o-mini-transcribe）共用同一個上限，
 * 依最嚴格的 Whisper 系列 prompt 上限（224 tokens）訂定。前端照樣送前一段的
 * 最後 200 字，由後端只保留最後 60 個字（以 Unicode 字元計，不切開代理對）。
 */
export const PROMPT_TAIL_CHARS = 60;

/**
 * Whisper 用 byte-level BPE，token 數不超過 UTF-8 位元組數，所以整個 prompt
 * （前綴 39 位元組 + 尾段）以 224 個 UTF-8 位元組為上限。一般繁體字每字 3 位元組，
 * 60 字加前綴是 219，不受影響；emoji、CJK 擴充 B 等字每字 4 位元組，尾段會少於 60 字。
 */
export const PROMPT_MAX_BYTES = 224;

const encoder = new TextEncoder();
const byteLength = (s: string) => encoder.encode(s).length;

export function buildPrompt(previousText: string): string {
  const chars = Array.from(previousText.trim());
  let budget = PROMPT_MAX_BYTES - byteLength(PROMPT_PREFIX);
  let start = chars.length;
  while (start > 0 && chars.length - start < PROMPT_TAIL_CHARS) {
    const size = byteLength(chars[start - 1]);
    if (size > budget) break;
    budget -= size;
    start -= 1;
  }
  const tail = chars.slice(start).join('').trimStart();
  return tail ? `${PROMPT_PREFIX}${tail}` : PROMPT_PREFIX;
}
