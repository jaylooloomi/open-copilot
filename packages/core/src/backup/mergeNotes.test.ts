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

  it('does not change its inputs', () => {
    const local = Object.freeze([note('a', 10)]);
    const incoming = Object.freeze([note('a', 20), note('b', 5)]);
    mergeNotes(local, incoming);
    expect(local).toEqual([note('a', 10)]);
    expect(incoming).toEqual([note('a', 20), note('b', 5)]);
  });
});
