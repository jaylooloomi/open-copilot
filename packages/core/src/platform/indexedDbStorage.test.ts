import { EMPTY_DOC, type Note } from '@oc/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { openAppDb } from './db';
import { createIndexedDbStorage } from './indexedDbStorage';
import type { NoteStorage } from './types';

const note = (id: string, updatedAt: number, title = id): Note => ({
  id,
  title,
  content: EMPTY_DOC,
  createdAt: 0,
  updatedAt,
});

describe('createIndexedDbStorage', () => {
  let storage: NoteStorage;

  beforeEach(async () => {
    storage = createIndexedDbStorage(await openAppDb(`test-${crypto.randomUUID()}`));
  });

  it('starts empty', async () => {
    expect(await storage.list()).toEqual([]);
    expect(await storage.get('missing')).toBeUndefined();
  });

  it('puts and gets a note', async () => {
    await storage.put(note('a', 1, '第一篇'));
    expect(await storage.get('a')).toEqual(note('a', 1, '第一篇'));
  });

  it('overwrites a note with the same id', async () => {
    await storage.put(note('a', 1, 'old'));
    await storage.put(note('a', 2, 'new'));
    expect(await storage.list()).toEqual([note('a', 2, 'new')]);
  });

  it('lists notes newest updatedAt first', async () => {
    await storage.put(note('a', 1));
    await storage.put(note('b', 3));
    await storage.put(note('c', 2));
    expect((await storage.list()).map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('removes a note', async () => {
    await storage.put(note('a', 1));
    await storage.put(note('b', 2));
    await storage.remove('a');
    expect((await storage.list()).map((n) => n.id)).toEqual(['b']);
  });
});
