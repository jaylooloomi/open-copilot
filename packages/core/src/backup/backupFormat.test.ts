import { EMPTY_DOC, type JSONContent, type Note } from '@oc/shared';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_APP,
  BACKUP_VERSION,
  backupFilename,
  createBackup,
  InvalidBackupError,
  parseBackup,
  serializeBackup,
} from './backupFormat';

const doc: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '議程' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '重要', marks: [{ type: 'bold' }] }] },
  ],
};

const note = (id: string, updatedAt: number, content: JSONContent = doc): Note => ({
  id,
  title: `筆記 ${id}`,
  content,
  createdAt: updatedAt - 10,
  updatedAt,
});

const valid = () => ({
  app: 'open-copilot',
  version: 1,
  exportedAt: 1_000,
  notes: [note('a', 100), note('b', 200, EMPTY_DOC)],
});

const text = (value: unknown) => JSON.stringify(value);

describe('backupFilename', () => {
  it('names the file after the local date and time', () => {
    expect(backupFilename(new Date(2026, 9, 22, 9, 5))).toBe('open-copilot-backup-20261022-0905.json');
    expect(backupFilename(new Date(2027, 0, 3, 23, 59))).toBe('open-copilot-backup-20270103-2359.json');
  });
});

describe('createBackup / serializeBackup', () => {
  it('wraps the notes with the app name, version and export time', () => {
    const notes = [note('a', 100)];
    expect(createBackup(notes, 1_000)).toEqual({
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      exportedAt: 1_000,
      notes,
    });
  });

  it('keeps only the Note fields', () => {
    const extra = { ...note('a', 100), audio: 'blob' } as Note;
    expect(createBackup([extra], 1).notes).toEqual([note('a', 100)]);
  });

  it('round-trips through parseBackup', () => {
    const backup = createBackup([note('a', 100), note('b', 200, EMPTY_DOC)], 1_000);
    expect(parseBackup(serializeBackup(backup))).toEqual(backup);
  });
});

describe('parseBackup', () => {
  it('accepts a file that starts with a byte order mark', () => {
    expect(parseBackup(`\uFEFF${text(valid())}`).notes).toHaveLength(2);
  });

  it('accepts a backup without notes', () => {
    expect(parseBackup(text({ ...valid(), notes: [] })).notes).toEqual([]);
  });

  it('drops unknown fields from the notes', () => {
    const notes = [{ ...note('a', 100), audio: 'x' }];
    expect(parseBackup(text({ ...valid(), notes })).notes).toEqual([note('a', 100)]);
  });

  const withNote = (patch: Record<string, unknown>) =>
    text({ ...valid(), notes: [{ ...note('a', 100), ...patch }] });

  const broken: [string, string][] = [
    ['text that is not JSON', '{'],
    ['an array', text([])],
    ['null', 'null'],
    ['another app', text({ ...valid(), app: 'other' })],
    ['a newer version', text({ ...valid(), version: 2 })],
    ['a missing exportedAt', text({ ...valid(), exportedAt: undefined })],
    ['notes that are not an array', text({ ...valid(), notes: {} })],
    ['a note that is not an object', text({ ...valid(), notes: ['a'] })],
    ['an empty id', withNote({ id: '' })],
    ['a title that is not a string', withNote({ title: 3 })],
    ['a missing updatedAt', withNote({ updatedAt: undefined })],
    ['a createdAt string', withNote({ createdAt: '2026-10-22' })],
    ['content that is not a doc', withNote({ content: { type: 'paragraph' } })],
    ['content with an unknown node', withNote({ content: { type: 'doc', content: [{ type: 'mystery' }] } })],
    [
      'content with an empty text node',
      withNote({ content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }] } }),
    ],
    ['duplicate ids', text({ ...valid(), notes: [note('a', 1), note('a', 2)] })],
  ];

  it.each(broken)('rejects %s', (_label, input) => {
    expect(() => parseBackup(input)).toThrow(InvalidBackupError);
  });
});
