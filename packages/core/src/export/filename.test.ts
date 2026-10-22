import { describe, expect, it } from 'vitest';
import { toFilename } from './filename';

describe('toFilename', () => {
  it('uses the trimmed title and the extension', () => {
    expect(toFilename('  週會紀錄  ', 'md')).toBe('週會紀錄.md');
    expect(toFilename('週會紀錄', 'docx')).toBe('週會紀錄.docx');
    expect(toFilename('週會紀錄', 'txt')).toBe('週會紀錄.txt');
    expect(toFilename('週會紀錄', 'pdf')).toBe('週會紀錄.pdf');
  });

  it('removes characters Windows does not allow in file names', () => {
    expect(toFilename('a\\b/c:d*e?f"g<h>i|j', 'md')).toBe('abcdefghij.md');
  });

  it('removes control characters', () => {
    expect(toFilename('a\u0000b\tc\u001fd\u007fe\u0085f', 'txt')).toBe('abcdef.txt');
  });

  it('keeps at most 80 characters, counting an emoji as one character', () => {
    expect(toFilename('字'.repeat(100), 'md')).toBe(`${'字'.repeat(80)}.md`);
    expect(toFilename('😀'.repeat(81), 'md')).toBe(`${'😀'.repeat(80)}.md`);
  });

  it('trims again after cutting so the name never ends with a space', () => {
    expect(toFilename(`${'a'.repeat(79)} b`, 'md')).toBe(`${'a'.repeat(79)}.md`);
  });

  it('falls back to 未命名筆記 when nothing usable is left', () => {
    expect(toFilename('', 'md')).toBe('未命名筆記.md');
    expect(toFilename('   ', 'docx')).toBe('未命名筆記.docx');
    expect(toFilename('???', 'pdf')).toBe('未命名筆記.pdf');
  });

  it('adds an underscore to Windows reserved device names', () => {
    expect(toFilename('CON', 'md')).toBe('CON_.md');
    expect(toFilename('nul', 'txt')).toBe('nul_.txt');
    expect(toFilename('Aux', 'pdf')).toBe('Aux_.pdf');
    expect(toFilename('prn', 'docx')).toBe('prn_.docx');
    expect(toFilename('COM1', 'md')).toBe('COM1_.md');
    expect(toFilename('lpt9', 'md')).toBe('lpt9_.md');
    expect(toFilename('con.backup', 'md')).toBe('con_.backup.md');
  });

  it('keeps names that only start with a reserved word', () => {
    expect(toFilename('Console', 'md')).toBe('Console.md');
    expect(toFilename('COM10', 'md')).toBe('COM10.md');
    expect(toFilename('nul 會議', 'md')).toBe('nul 會議.md');
  });
});
