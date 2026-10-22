import type { Note } from '@oc/shared';
import { sortByUpdatedDesc } from '../notes/noteStore';

export interface MergeResult {
  /** Local and imported notes together, newest `updatedAt` first. */
  notes: Note[];
  /** Imported notes that were added or replaced a local one, in import order; store these. */
  toWrite: Note[];
  /** Notes added or replaced (`toWrite.length`). */
  imported: number;
  /** Imported notes whose local copy is as new or newer; the local copy is kept. */
  skipped: number;
}

/**
 * Merges imported notes into the local ones by `id`: an unknown id is added, and a known one is
 * replaced only when the imported `updatedAt` is strictly newer.
 */
export function mergeNotes(local: readonly Note[], incoming: readonly Note[]): MergeResult {
  const byId = new Map(local.map((note) => [note.id, note]));
  const toWrite: Note[] = [];
  let skipped = 0;
  for (const note of incoming) {
    const existing = byId.get(note.id);
    if (existing && existing.updatedAt >= note.updatedAt) {
      skipped += 1;
      continue;
    }
    byId.set(note.id, note);
    toWrite.push(note);
  }
  return { notes: sortByUpdatedDesc([...byId.values()]), toWrite, imported: toWrite.length, skipped };
}
