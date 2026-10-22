import type { Note } from '@oc/shared';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/** Audio segment waiting for a manual retry (used from M3b). */
export interface PendingSegmentRecord {
  gapId: string;
  noteId: string;
  seq: number;
  blob: Blob;
  mimeType: string;
  prompt: string;
}

export interface AppDbSchema extends DBSchema {
  notes: { key: string; value: Note };
  pendingSegments: { key: string; value: PendingSegmentRecord };
}

export const APP_DB_VERSION = 1;

export async function openAppDb(name = 'open-copilot'): Promise<IDBPDatabase<AppDbSchema>> {
  const db = await openDB<AppDbSchema>(name, APP_DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('notes', { keyPath: 'id' });
      db.createObjectStore('pendingSegments', { keyPath: 'gapId' });
    },
    // An older tab still holds the database open at a lower version; its own `blocking`
    // handler (below) closes it, so the upgrade continues once it has.
    blocked() {
      console.warn('Waiting for another open-copilot tab to release the database');
    },
  });
  // A newer version of the app is opening the database in another tab: let its upgrade run
  // instead of blocking it. This tab's later reads and writes fail and are reported as such.
  db.addEventListener('versionchange', () => db.close());
  return db;
}
