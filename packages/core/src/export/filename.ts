import { UNTITLED_NOTE } from '../notes/noteStore';

export type ExportFormat = 'md' | 'docx' | 'txt' | 'pdf';

const MAX_NAME_LENGTH = 80;

/** Characters Windows forbids in file names, plus C0/C1 control characters. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/g;

/**
 * Windows device names (CON, NUL, COM1 ...). Windows treats them as devices
 * even with an extension, so "CON.md" and "con.backup.md" are both unusable.
 */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?=\.|$)/i;

export function toFilename(title: string, ext: ExportFormat): string {
  const cleaned = title.replace(FORBIDDEN, '').trim();
  // Array.from splits by code point, so an emoji is never cut in half.
  const name = Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join('').trim();
  const safe = name.replace(RESERVED, '$1_');
  return `${safe || UNTITLED_NOTE}.${ext}`;
}
