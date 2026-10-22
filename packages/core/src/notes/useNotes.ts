import type { JSONContent, Note } from '@oc/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NoteStorage } from '../platform/types';
import { debounce } from './debounce';
import { createNote as makeNote, sortByUpdatedDesc } from './noteStore';

export const SAVE_DELAY_MS = 500;

export interface NotePatch {
  title?: string;
  content?: JSONContent;
}

export interface UseNotesOptions {
  /** Clock for createdAt/updatedAt; injectable for tests. */
  now?: () => number;
  saveDelayMs?: number;
}

export interface UseNotesResult {
  /** Newest `updatedAt` first. */
  notes: Note[];
  activeNote: Note | undefined;
  loading: boolean;
  createNote(): Promise<Note>;
  selectNote(id: string): void;
  deleteNote(id: string): Promise<void>;
  updateActive(patch: NotePatch): void;
}

export function useNotes(storage: NoteStorage, options: UseNotesOptions = {}): UseNotesResult {
  const now = useRef(options.now ?? Date.now).current;
  const saveDelayMs = options.saveDelayMs ?? SAVE_DELAY_MS;

  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  // Refs mirror the state so callbacks always see the latest values synchronously.
  const notesRef = useRef<Note[]>([]);
  const activeIdRef = useRef<string | undefined>(undefined);
  const pendingRef = useRef<Note | undefined>(undefined);

  const commit = useCallback((next: Note[], nextActiveId: string | undefined) => {
    notesRef.current = next;
    activeIdRef.current = nextActiveId;
    setNotes(next);
    setActiveId(nextActiveId);
  }, []);

  const saver = useMemo(
    () =>
      debounce(() => {
        const note = pendingRef.current;
        pendingRef.current = undefined;
        if (note) {
          storage.put(note).catch((error: unknown) => console.error('Failed to save note', error));
        }
      }, saveDelayMs),
    [storage, saveDelayMs],
  );

  useEffect(() => {
    const flush = () => saver.flush();
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') saver.flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      saver.flush();
    };
  }, [saver]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let list = await storage.list();
      if (cancelled) return;
      if (list.length === 0) {
        const first = makeNote(now());
        await storage.put(first);
        if (cancelled) return;
        list = [first];
      }
      commit(list, list[0].id);
      setLoading(false);
    };
    load().catch((error: unknown) => console.error('Failed to load notes', error));
    return () => {
      cancelled = true;
    };
  }, [storage, now, commit]);

  const createNote = useCallback(async () => {
    saver.flush();
    const note = makeNote(now());
    await storage.put(note);
    commit(sortByUpdatedDesc([note, ...notesRef.current]), note.id);
    return note;
  }, [storage, now, saver, commit]);

  const selectNote = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) return;
      if (!notesRef.current.some((n) => n.id === id)) return;
      saver.flush();
      commit(notesRef.current, id);
    },
    [saver, commit],
  );

  const deleteNote = useCallback(
    async (id: string) => {
      const removed = notesRef.current.find((n) => n.id === id);
      // Unknown id, or this note is already being deleted.
      if (!removed) return;

      // Take the note out of memory before any await: once it is gone, updateActive
      // cannot target it, so no later save can write the deleted note back.
      const droppedEdit = pendingRef.current?.id === id;
      if (droppedEdit) {
        saver.cancel();
        pendingRef.current = undefined;
      }
      const previousActiveId = activeIdRef.current;
      let remaining = notesRef.current.filter((n) => n.id !== id);
      // Deleting the last note: show an empty replacement at once, so there is always an
      // active note. It is stored once the remove has succeeded.
      const replacement = remaining.length === 0 ? makeNote(now()) : undefined;
      if (replacement) remaining = [replacement];
      const nextActiveId =
        replacement?.id ?? (previousActiveId === id ? remaining[0]?.id : previousActiveId);
      commit(remaining, nextActiveId);

      try {
        await storage.remove(id);
      } catch (error) {
        // The note is still stored, so put it back in the list. The replacement goes
        // unless it was edited meanwhile (an edit swaps in a new object).
        const kept = notesRef.current.filter((n) => n !== replacement);
        const activeAfter =
          activeIdRef.current === nextActiveId ? previousActiveId : activeIdRef.current;
        commit(sortByUpdatedDesc([removed, ...kept]), activeAfter);
        if (droppedEdit) {
          storage.put(removed).catch((e: unknown) => console.error('Failed to save note', e));
        }
        throw error;
      }

      if (replacement) {
        // Edits may have landed on the replacement during the remove: store its latest
        // version, and drop a pending save of it so an older version cannot win.
        const latest = notesRef.current.find((n) => n.id === replacement.id);
        if (!latest) return;
        if (pendingRef.current?.id === latest.id) {
          saver.cancel();
          pendingRef.current = undefined;
        }
        // The note is already deleted, so a failed store of the replacement must not reject:
        // there is nothing to retry. Log it like a failed autosave; the replacement stays in
        // memory and its next edit stores it (an empty list also gets a fresh note on load).
        try {
          await storage.put(latest);
        } catch (error) {
          console.error('Failed to save note', error);
        }
      }
    },
    [storage, now, saver, commit],
  );

  const updateActive = useCallback(
    (patch: NotePatch) => {
      const id = activeIdRef.current;
      const current = notesRef.current.find((n) => n.id === id);
      if (!current) return;
      const updated: Note = {
        ...current,
        title: patch.title ?? current.title,
        content: patch.content ?? current.content,
        updatedAt: now(),
      };
      commit(
        sortByUpdatedDesc(notesRef.current.map((n) => (n.id === updated.id ? updated : n))),
        updated.id,
      );
      pendingRef.current = updated;
      saver();
    },
    [now, saver, commit],
  );

  const activeNote = useMemo(() => notes.find((n) => n.id === activeId), [notes, activeId]);

  return { notes, activeNote, loading, createNote, selectNote, deleteNote, updateActive };
}
