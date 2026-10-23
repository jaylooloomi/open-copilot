import { EMPTY_DOC, type Note } from '@oc/shared';
import { describe, expect, it } from 'vitest';
import { mergeNotes } from './mergeNotes';

const note = (id: string, updatedAt: number, title = id): Note => ({
  id,
  title,
  content: EMPTY_DOC,
  createdAt: 1,
  updatedAt,
});

describe('mergeNotes', () => {
  it('adds notes that are not here yet', () => {
    const result = mergeNotes([note('a', 10)], [note('b', 20)]);
    expect(result.notes.map((n) => n.id)).toEqual(['b', 'a']);
    expect(result.toWrite).toEqual([note('b', 20)]);
    expect(result).toMatchObject({ imported: 1, skipped: 0 });
  });

  it('replaces a local note with a newer imported version', () => {
    const result = mergeNotes([note('a', 10, '舊'), note('b', 5)], [note('a', 30, '新')]);
    expect(result.notes).toEqual([note('a', 30, '新'), note('b', 5)]);
    expect(result.toWrite).toEqual([note('a', 30, '新')]);
    expect(result).toMatchObject({ imported: 1, skipped: 0 });
  });

  it('keeps the local note when it is newer and counts the imported one as skipped', () => {
    const result = mergeNotes([note('a', 30, '本機')], [note('a', 10, '備份')]);
    expect(result.notes).toEqual([note('a', 30, '本機')]);
    expect(result.toWrite).toEqual([]);
    expect(result).toMatchObject({ imported: 0, skipped: 1 });
  });

  it('keeps the local note when both have the same updatedAt', () => {
    const result = mergeNotes([note('a', 10, '本機')], [note('a', 10, '備份')]);
    expect(result.notes).toEqual([note('a', 10, '本機')]);
    expect(result).toMatchObject({ imported: 0, skipped: 1 });
  });

  it('returns the local notes newest first when nothing is imported', () => {
    const result = mergeNotes([note('a', 1), note('b', 2)], []);
    expect(result.notes.map((n) => n.id)).toEqual(['b', 'a']);
    expect(result).toMatchObject({ toWrite: [], imported: 0, skipped: 0 });
  });

  it('writes a repeated imported id once, keeping its newest copy', () => {
    const result = mergeNotes([note('a', 10)], [note('a', 20, '一'), note('a', 30, '二'), note('a', 25, '三')]);
    expect(result.notes).toEqual([note('a', 30, '二')]);
    expect(result.toWrite).toEqual([note('a', 30, '二')]);
    expect(result).toMatchObject({ imported: 1, skipped: 1 });
  });

  it('does not change its inputs', () => {
    const localNote = Object.freeze(note('a', 10));
    const newer = Object.freeze(note('a', 20));
    const added = Object.freeze(note('b', 5));
    const local = Object.freeze([localNote]);
    const incoming = Object.freeze([newer, added]);
    const result = mergeNotes(local, incoming);
    expect(local).toEqual([note('a', 10)]);
    expect(incoming).toEqual([note('a', 20), note('b', 5)]);
    expect(result.notes[0]).toBe(newer);
    expect(result.notes[1]).toBe(added);
    expect(result.toWrite[0]).toBe(newer);
    expect(result.toWrite[1]).toBe(added);
  });
});
