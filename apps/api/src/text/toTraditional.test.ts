import { describe, expect, it } from 'vitest';
import { toTraditional } from './toTraditional';

describe('toTraditional', () => {
  it('converts simplified Chinese to Taiwan traditional Chinese', () => {
    expect(toTraditional('这是简体中文')).toBe('這是簡體中文');
    expect(toTraditional('后来我们去开会')).toBe('後來我們去開會');
  });

  it('converts glyphs only, not Taiwan vocabulary (tw, not twp)', () => {
    expect(toTraditional('软件')).toBe('軟件');
  });

  it('leaves traditional Chinese, ASCII and empty strings unchanged', () => {
    expect(toTraditional('這是繁體中文')).toBe('這是繁體中文');
    expect(toTraditional('OK, 123!')).toBe('OK, 123!');
    expect(toTraditional('')).toBe('');
  });
});
