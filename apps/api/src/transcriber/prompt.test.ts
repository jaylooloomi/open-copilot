import { describe, expect, it } from 'vitest';
import { PROMPT_PREFIX, PROMPT_TAIL_CHARS, buildPrompt } from './prompt';

describe('buildPrompt', () => {
  it('prefixes the traditional Chinese guide text', () => {
    expect(PROMPT_PREFIX).toBe('以下是繁體中文的語音內容。');
    expect(buildPrompt('上一段的內容')).toBe('以下是繁體中文的語音內容。上一段的內容');
  });

  it('returns only the prefix for blank input', () => {
    expect(buildPrompt('')).toBe(PROMPT_PREFIX);
    expect(buildPrompt('  \n ')).toBe(PROMPT_PREFIX);
  });

  it('keeps text of exactly 80 characters whole', () => {
    const text = '字'.repeat(80);
    expect(buildPrompt(text)).toBe(PROMPT_PREFIX + text);
  });

  it('keeps only the last 80 characters of a long prompt', () => {
    // Whisper 系列的 prompt 上限是 224 tokens；前端照樣送最後 200 字，由後端截斷。
    expect(PROMPT_TAIL_CHARS).toBe(80);
    const head = '甲'.repeat(120);
    const tail = '乙'.repeat(80);
    expect(buildPrompt(head + tail)).toBe(PROMPT_PREFIX + tail);
  });

  it('trims the 200-character prompt the frontend sends', () => {
    const text = Array.from({ length: 200 }, (_, i) => String.fromCharCode(0x4e00 + i)).join('');
    const result = buildPrompt(text);
    expect(Array.from(result.slice(PROMPT_PREFIX.length))).toHaveLength(80);
    expect(result).toBe(PROMPT_PREFIX + text.slice(-80));
  });

  it('counts characters, not UTF-16 code units, so astral characters are never split', () => {
    const astral = '\u{20000}'; // 𠀀，UTF-16 是兩個 code unit
    expect(buildPrompt(astral.repeat(100))).toBe(PROMPT_PREFIX + astral.repeat(80));
  });

  it('trims surrounding whitespace before counting', () => {
    expect(buildPrompt(`  ${'字'.repeat(80)}  \n`)).toBe(PROMPT_PREFIX + '字'.repeat(80));
  });

  it('drops leading whitespace left at the cut', () => {
    // 最後 80 個字是「一個空白 + 79 個『後』」
    const text = '前'.repeat(10) + ' ' + '後'.repeat(79);
    expect(buildPrompt(text)).toBe(PROMPT_PREFIX + '後'.repeat(79));
  });
});
