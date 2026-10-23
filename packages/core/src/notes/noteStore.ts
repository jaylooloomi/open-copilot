import { EMPTY_DOC, type Note } from '@oc/shared';

export const UNTITLED_NOTE = '未命名筆記';

export function createNote(now: number = Date.now()): Note {
  return {
    id: crypto.randomUUID(),
    title: '',
    content: structuredClone(EMPTY_DOC),
    createdAt: now,
    updatedAt: now,
  };
}

export function sortByUpdatedDesc(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}

/** Title shown in the note list; blank titles become 未命名筆記. */
export function displayTitle(note: Pick<Note, 'title'>): string {
  return note.title.trim() || UNTITLED_NOTE;
}
