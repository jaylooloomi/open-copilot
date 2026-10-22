import type { Note } from '@oc/shared';
import { vi } from 'vitest';
import { sortByUpdatedDesc } from '../notes/noteStore';
import type { NoteStorage } from '../platform/types';

/** In-memory NoteStorage whose methods are vi.fn spies, for hook and component tests. */
export function createMemoryStorage(initial: Note[] = []) {
  const notes = new Map(initial.map((n) => [n.id, structuredClone(n)]));
  const storage = {
    list: vi.fn(async () => sortByUpdatedDesc([...notes.values()].map((n) => structuredClone(n)))),
    get: vi.fn(async (id: string) => {
      const n = notes.get(id);
      return n && structuredClone(n);
    }),
    put: vi.fn(async (note: Note) => {
      notes.set(note.id, structuredClone(note));
    }),
    remove: vi.fn(async (id: string) => {
      notes.delete(id);
    }),
  } satisfies NoteStorage;
  return { storage, notes };
}

/** A minimal platform for rendering components in tests. */
export function createTestPlatform(initial: Note[] = []) {
  const { storage, notes } = createMemoryStorage(initial);
  const fileSaver = { save: vi.fn(async (_filename: string, _data: Blob) => undefined) };
  return { platform: { storage, fileSaver, canPrint: true }, storage, notes, fileSaver };
}
