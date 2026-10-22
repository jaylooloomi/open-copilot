import type { Note } from '@oc/shared';
import { sortByUpdatedDesc } from '../notes/noteStore';

export interface MergeResult {
  /** Local and imported notes together, newest `updatedAt` first. */
  notes: Note[];
  /**
   * Imported notes that were added or replaced a local one, one per id, in the order each id was
   * first written; store these.
   */
  toWrite: Note[];
  /** Notes added or replaced (`toWrite.length`). */
  imported: number;
  /** Imported notes whose local copy is as new or newer; the local copy is kept. */
  skipped: number;
}

/**
 * Merges imported notes into the local ones by `id`: an unknown id is added, and a known one is
 * replaced only when the imported `updatedAt` is strictly newer. `parseBackup` already rejects
 * repeated ids; if `incoming` still repeats one, its newest copy wins and is written once.
 */
export function mergeNotes(local: readonly Note[], incoming: readonly Note[]): MergeResult {
  const byId = new Map(local.map((note) => [note.id, note]));
  const written = new Map<string, Note>();
  let skipped = 0;
  for (const note of incoming) {
    const existing = byId.get(note.id);
    if (existing && existing.updatedAt >= note.updatedAt) {
      skipped += 1;
      continue;
    }
    byId.set(note.id, note);
    written.set(note.id, note);
  }
  const toWrite = [...written.values()];
  return { notes: sortByUpdatedDesc([...byId.values()]), toWrite, imported: toWrite.length, skipped };
}
