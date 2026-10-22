import type { IDBPDatabase } from 'idb';
import type { AppDbSchema, PendingSegmentRecord } from '../platform/db';

/** Audio of a segment that is still untranscribed, kept until a retry succeeds. */
export type PendingSegment = PendingSegmentRecord;

/** The app database, or the promise openAppDb() returned. */
export type AppDbHandle = IDBPDatabase<AppDbSchema> | Promise<IDBPDatabase<AppDbSchema>>;

export interface PendingQueue {
  add(item: PendingSegment): Promise<void>;
  get(gapId: string): Promise<PendingSegment | undefined>;
  remove(gapId: string): Promise<void>;
  /** Drops the audio of every gap in a note that was deleted (its markers can never be retried). */
  removeByNote(noteId: string): Promise<void>;
}

/** The `pendingSegments` store (keyPath `gapId`) as a small queue API. */
export function createPendingQueue(db: AppDbHandle): PendingQueue {
  return {
    async add(item) {
      const conn = await db;
      const tx = conn.transaction('pendingSegments', 'readwrite');
      const request = tx.store.put(item);
      // Commit explicitly, like NoteStorage.put: the write may happen while the page is closing.
      tx.commit();
      await Promise.all([request, tx.done]);
    },
    async get(gapId) {
      return (await db).get('pendingSegments', gapId);
    },
    async remove(gapId) {
      await (await db).delete('pendingSegments', gapId);
    },
    async removeByNote(noteId) {
      const conn = await db;
      const tx = conn.transaction('pendingSegments', 'readwrite');
      // No noteId index (the M1 schema stays at version 1); the store only ever holds a few rows.
      const rows = await tx.store.getAll();
      const deletes = rows.filter((row) => row.noteId === noteId).map((row) => tx.store.delete(row.gapId));
      await Promise.all([...deletes, tx.done]);
    },
  };
}
