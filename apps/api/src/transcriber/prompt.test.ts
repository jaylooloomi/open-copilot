import { describe, expect, it } from 'vitest';
import { PROMPT_MAX_BYTES, PROMPT_PREFIX, PROMPT_TAIL_CHARS, buildPrompt } from './prompt';

describe('buildPrompt', () => {
  it('prefixes the traditional Chinese guide text', () => {
    expect(PROMPT_PREFIX).toBe('以下是繁體中文的語音內容。');
    expect(buildPrompt('上一段的內容')).toBe('以下是繁體中文的語音內容。上一段的內容');
  });

  it('returns only the prefix for blank input', () => {
    expect(buildPrompt('')).toBe(PROMPT_PREFIX);
    expect(buildPrompt('  \n ')).toBe(PROMPT_PREFIX);
  });

  it('keeps text of exactly 60 characters whole', () => {
    const text = '字'.repeat(60);
    expect(buildPrompt(text)).toBe(PROMPT_PREFIX + text);
  });

  it('keeps only the last 60 characters of a long prompt', () => {
    // Whisper 系列的 prompt 上限是 224 tokens；前端照樣送最後 200 字，由後端截斷。
    expect(PROMPT_TAIL_CHARS).toBe(60);
    const head = '甲'.repeat(140);
    const tail = '乙'.repeat(60);
    expect(buildPrompt(head + tail)).toBe(PROMPT_PREFIX + tail);
  });

  it('trims the 200-character prompt the frontend sends', () => {
    const text = Array.from({ length: 200 }, (_, i) => String.fromCharCode(0x4e00 + i)).join('');
    const result = buildPrompt(text);
    expect(Array.from(result.slice(PROMPT_PREFIX.length))).toHaveLength(60);
    expect(result).toBe(PROMPT_PREFIX + text.slice(-60));
  });

  it('stays within 224 tokens even if every BMP character costs one token per UTF-8 byte', () => {
    // Whisper 的 tokenizer 是 byte-level BPE，token 數不會超過 UTF-8 位元組數。
    // 罕用繁體字可能每字 2–3 個 token，所以用位元組數當最壞情況的上限。
    const rare = Array.from({ length: 200 }, (_, i) => String.fromCharCode(0x9f00 + i)).join('');
    expect(new TextEncoder().encode(buildPrompt(rare)).length).toBeLessThanOrEqual(224);
  });

  it('counts characters, not UTF-16 code units, so astral characters are never split', () => {
    const astral = '\u{20000}'; // 𠀀，UTF-16 是兩個 code unit
    const tail = buildPrompt(astral.repeat(100)).slice(PROMPT_PREFIX.length);
    expect(tail.length).toBeGreaterThan(0);
    expect(tail).toBe(astral.repeat(Array.from(tail).length));
  });

  it('bounds the prompt by UTF-8 bytes when the tail has 4-byte characters', () => {
    // 罕用字（CJK Extension B）與 emoji 每字 4 個位元組，60 字會超過 224。
    expect(PROMPT_MAX_BYTES).toBe(224);
    const bytes = (s: string) => new TextEncoder().encode(s).length;
    for (const ch of ['\u{20000}', '😀']) {
      const result = buildPrompt(ch.repeat(200));
      expect(bytes(result)).toBeLessThanOrEqual(224);
      // 前綴 39 位元組，剩下 185 位元組最多放 46 個 4 位元組字。
      expect(result).toBe(PROMPT_PREFIX + ch.repeat(46));
    }
  });

  it('mixes 3-byte and 4-byte characters without exceeding 224 bytes', () => {
    const mixed = Array.from({ length: 200 }, (_, i) => (i % 2 ? '😀' : '字')).join('');
    const result = buildPrompt(mixed);
    expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(224);
    expect(mixed.endsWith(result.slice(PROMPT_PREFIX.length))).toBe(true);
  });

  it('trims surrounding whitespace before counting', () => {
    expect(buildPrompt(`  ${'字'.repeat(60)}  \n`)).toBe(PROMPT_PREFIX + '字'.repeat(60));
  });

  it('drops leading whitespace left at the cut', () => {
    // 最後 60 個字是「一個空白 + 59 個『後』」
    const text = '前'.repeat(10) + ' ' + '後'.repeat(59);
    expect(buildPrompt(text)).toBe(PROMPT_PREFIX + '後'.repeat(59));
  });
});
