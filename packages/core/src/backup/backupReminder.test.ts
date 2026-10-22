import { EMPTY_DOC, type JSONContent, type Note } from '@oc/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRANSCRIPT_GAP_TYPE } from '../export/common';
import {
  BACKUP_REMINDER_MS,
  isBackupDue,
  isBlankNote,
  LAST_BACKUP_KEY,
  loadLastBackupAt,
  saveLastBackupAt,
} from './backupReminder';

const note = (title: string, content: JSONContent = EMPTY_DOC): Note => ({
  id: crypto.randomUUID(),
  title,
  content,
  createdAt: 1,
  updatedAt: 1,
});

const paragraphs = (...children: JSONContent[][]): JSONContent => ({
  type: 'doc',
  content: children.map((content) => ({ type: 'paragraph', content })),
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('isBlankNote', () => {
  it('treats a new note as blank', () => {
    expect(isBlankNote(note(''))).toBe(true);
  });

  it('treats spaces, line breaks and empty paragraphs as blank', () => {
    const content = paragraphs([{ type: 'text', text: '  ' }, { type: 'hardBreak' }], []);
    expect(isBlankNote(note('   ', content))).toBe(true);
  });

  it('counts a title', () => {
    expect(isBlankNote(note('週會'))).toBe(false);
  });

  it('counts body text', () => {
    expect(isBlankNote(note('', paragraphs([{ type: 'text', text: '內容' }])))).toBe(false);
  });

  it('counts body text under a whitespace-only title', () => {
    expect(isBlankNote(note('   ', paragraphs([{ type: 'text', text: '內容' }])))).toBe(false);
  });

  it('judges a node without a type by its text and children', () => {
    expect(isBlankNote(note('', { content: [{ text: '  ' }, { content: [] }] }))).toBe(true);
    expect(isBlankNote(note('', { content: [{ text: '內容' }] }))).toBe(false);
  });

  it('counts other nodes, such as a transcript gap marker', () => {
    const content: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: TRANSCRIPT_GAP_TYPE, attrs: { gapId: 'g', seq: 1 } }] }],
    };
    expect(isBlankNote(note('', content))).toBe(false);
  });
});

describe('isBackupDue', () => {
  const NOW = 1_000_000_000_000;
  const written = [note(''), note('週會')];

  it('does not remind while every note is blank', () => {
    expect(isBackupDue([note('')], undefined, NOW)).toBe(false);
    expect(isBackupDue([], undefined, NOW)).toBe(false);
  });

  it('reminds when there are notes and no backup was ever made', () => {
    expect(isBackupDue(written, undefined, NOW)).toBe(true);
  });

  it('reminds only after more than 7 days', () => {
    expect(isBackupDue(written, NOW - BACKUP_REMINDER_MS, NOW)).toBe(false);
    expect(isBackupDue(written, NOW - BACKUP_REMINDER_MS - 1, NOW)).toBe(true);
  });

  it('reminds when the last backup time lies in the future, for example after a clock change', () => {
    expect(isBackupDue(written, NOW + 1, NOW)).toBe(true);
    expect(isBackupDue(written, NOW, NOW)).toBe(false);
  });
});

describe('loadLastBackupAt / saveLastBackupAt', () => {
  it('stores the time under oc.lastBackupAt and reads it back', () => {
    saveLastBackupAt(1234);
    expect(localStorage.getItem(LAST_BACKUP_KEY)).toBe('1234');
    expect(loadLastBackupAt()).toBe(1234);
  });

  it.each([['missing', null], ['empty', ''], ['not a number', 'abc'], ['zero', '0'], ['negative', '-5']])(
    'reads %s as never backed up',
    (_label, raw) => {
      if (raw !== null) localStorage.setItem(LAST_BACKUP_KEY, raw);
      expect(loadLastBackupAt()).toBeUndefined();
    },
  );

  it('treats unreadable storage as never backed up', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadLastBackupAt()).toBeUndefined();
  });

  it('logs instead of throwing when the time cannot be stored', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => saveLastBackupAt(1)).not.toThrow();
    expect(error).toHaveBeenCalledWith('Failed to save the last backup time', expect.any(Error));
  });
});
