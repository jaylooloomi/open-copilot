import { EMPTY_DOC, type Note } from '@oc/shared';
import { deleteDB, type IDBPDatabase } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openAppDb, type AppDbSchema } from './db';
import { createIndexedDbStorage } from './indexedDbStorage';
import type { NoteStorage } from './types';

const note = (id: string, updatedAt: number, title = id): Note => ({
  id,
  title,
  content: EMPTY_DOC,
  createdAt: 0,
  updatedAt,
});

type CommitSlot = { commit?: (this: IDBTransaction) => void };

/** Collects unhandled promise rejections until the returned stop() is called. */
function watchUnhandledRejections() {
  const reasons: unknown[] = [];
  const onUnhandled = (reason: unknown) => reasons.push(reason);
  process.on('unhandledRejection', onUnhandled);
  return {
    reasons,
    async stop() {
      // Unhandled rejections are reported after the microtask queue drains.
      await new Promise((resolve) => setTimeout(resolve, 20));
      process.off('unhandledRejection', onUnhandled);
    },
  };
}

describe('createIndexedDbStorage', () => {
  let name: string;
  let db: IDBPDatabase<AppDbSchema>;
  let storage: NoteStorage;
  const originalCommit = (IDBTransaction.prototype as CommitSlot).commit;

  beforeEach(async () => {
    name = `test-${crypto.randomUUID()}`;
    db = await openAppDb(name);
    storage = createIndexedDbStorage(db);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    (IDBTransaction.prototype as CommitSlot).commit = originalCommit;
    db.close();
    await deleteDB(name);
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

  it('rejects a note that cannot be stored and keeps working afterwards', async () => {
    const watch = watchUnhandledRejections();
    const uncloneable = { ...note('a', 1), content: { fn: () => 1 } } as unknown as Note;

    await expect(storage.put(uncloneable)).rejects.toThrow();
    await storage.put(note('b', 2));

    expect((await storage.list()).map((n) => n.id)).toEqual(['b']);
    await watch.stop();
    expect(watch.reasons).toEqual([]);
  });

  it('rejects exactly once, with no unhandled rejection, when the write fails after it was queued', async () => {
    // Abort the transaction in place of committing it: the queued put request and the
    // transaction both fail asynchronously, as they do on a quota error.
    vi.spyOn(IDBTransaction.prototype, 'commit').mockImplementation(function (this: IDBTransaction) {
      this.abort();
    });
    const watch = watchUnhandledRejections();

    await expect(storage.put(note('a', 1))).rejects.toThrow();

    await watch.stop();
    expect(watch.reasons).toEqual([]);
    vi.restoreAllMocks();
    expect(await storage.list()).toEqual([]);
  });

  it('still saves on a WebView without IDBTransaction.commit (pre Chrome 76)', async () => {
    (IDBTransaction.prototype as CommitSlot).commit = undefined;

    await storage.put(note('a', 1));

    expect((await storage.list()).map((n) => n.id)).toEqual(['a']);
  });
});
