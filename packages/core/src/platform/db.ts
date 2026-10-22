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

export function openAppDb(name = 'open-copilot'): Promise<IDBPDatabase<AppDbSchema>> {
  return openDB<AppDbSchema>(name, APP_DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('notes', { keyPath: 'id' });
      db.createObjectStore('pendingSegments', { keyPath: 'gapId' });
    },
  });
}
