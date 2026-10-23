import type { IDBPDatabase } from 'idb';
import { sortByUpdatedDesc } from '../notes/noteStore';
import type { AppDbSchema } from './db';
import type { NoteStorage } from './types';

export function createIndexedDbStorage(db: IDBPDatabase<AppDbSchema>): NoteStorage {
  return {
    async list() {
      return sortByUpdatedDesc(await db.getAll('notes'));
    },
    get(id) {
      return db.get('notes', id);
    },
    async put(note) {
      const tx = db.transaction('notes', 'readwrite');
      const request = tx.store.put(note);
      // Commit explicitly: a save flushed from a `pagehide` handler (reload / closing the tab)
      // is otherwise aborted by Chrome before the auto-commit happens. WebViews older than
      // Chrome 76 lack commit(); there the transaction still auto-commits.
      tx.commit?.();
      // Await the request too, so a failed write (quota, abort, uncloneable value) rejects
      // exactly once here instead of also surfacing as an unhandled rejection.
      await Promise.all([request, tx.done]);
    },
    async remove(id) {
      await db.delete('notes', id);
    },
  };
}
