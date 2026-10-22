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
  /**
   * Drops the audio of every gap recorded in a note that was deleted, except the gapIds in `keep`
   * (markers that were copied into a note that still exists).
   */
  removeByNote(noteId: string, keep?: ReadonlySet<string>): Promise<void>;
  /** Drops the audio of every gap whose gapId is not in `referenced` (no note has its marker). */
  removeUnreferenced(referenced: ReadonlySet<string>): Promise<void>;
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
    removeByNote(noteId, keep = new Set()) {
      return removeWhere(db, (row) => row.noteId === noteId && !keep.has(row.gapId));
    },
    removeUnreferenced(referenced) {
      return removeWhere(db, (row) => !referenced.has(row.gapId));
    },
  };
}

async function removeWhere(db: AppDbHandle, drop: (row: PendingSegment) => boolean): Promise<void> {
  const conn = await db;
  const tx = conn.transaction('pendingSegments', 'readwrite');
  // No noteId index (the M1 schema stays at version 1); the store only ever holds a few rows.
  const rows = await tx.store.getAll();
  const deletes = rows.filter(drop).map((row) => tx.store.delete(row.gapId));
  await Promise.all([...deletes, tx.done]);
}
