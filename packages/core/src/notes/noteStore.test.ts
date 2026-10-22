import { EMPTY_DOC, type Note } from '@oc/shared';
import { describe, expect, it } from 'vitest';
import { createNote, displayTitle, sortByUpdatedDesc } from './noteStore';

const note = (id: string, updatedAt: number, createdAt = 0): Note => ({
  id,
  title: id,
  content: EMPTY_DOC,
  createdAt,
  updatedAt,
});

describe('createNote', () => {
  it('creates an empty untitled note stamped with the given time', () => {
    const n = createNote(1_700_000_000_000);
    expect(n).toEqual({
      id: expect.any(String),
      title: '',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
  });

  it('gives every note a unique id and its own content object', () => {
    const a = createNote(1);
    const b = createNote(1);
    expect(a.id).not.toBe(b.id);
    expect(a.content).not.toBe(EMPTY_DOC);
    expect(a.content).not.toBe(b.content);
    expect(a.content.content).not.toBe(b.content.content);
  });

  it('returns content the editor can mutate (EMPTY_DOC itself is frozen)', () => {
    const a = createNote(1);
    const b = createNote(1);
    expect(() => a.content.content!.push({ type: 'paragraph' })).not.toThrow();
    expect(a.content.content).toHaveLength(2);
    expect(b.content).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(EMPTY_DOC).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});

describe('sortByUpdatedDesc', () => {
  it('orders newest first without mutating the input', () => {
    const input = [note('a', 1), note('b', 3), note('c', 2)];
    expect(sortByUpdatedDesc(input).map((n) => n.id)).toEqual(['b', 'c', 'a']);
    expect(input.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks updatedAt ties by createdAt, newest first', () => {
    const input = [note('old', 5, 1), note('new', 5, 2)];
    expect(sortByUpdatedDesc(input).map((n) => n.id)).toEqual(['new', 'old']);
  });
});

describe('displayTitle', () => {
  it('returns the trimmed title', () => {
    expect(displayTitle({ title: '  週會紀錄 ' })).toBe('週會紀錄');
  });

  it('falls back to 未命名筆記 for blank titles', () => {
    expect(displayTitle({ title: '' })).toBe('未命名筆記');
    expect(displayTitle({ title: '   ' })).toBe('未命名筆記');
  });
});
