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
  /** The notes could not be loaded; `loading` is false and there is no active note. */
  loadError: boolean;
  /** Clears `loadError` and loads the notes again. */
  retryLoad(): void;
  /**
   * The last autosave failed. The unsaved note stays pending and is written again with the
   * next edit, note switch or page hide; this clears once a save succeeds.
   */
  saveFailed: boolean;
  /** Hides `saveFailed` until the next failure (the unsaved edit stays pending). */
  dismissSaveError(): void;
  createNote(): Promise<Note>;
  selectNote(id: string): void;
  deleteNote(id: string): Promise<void>;
  updateActive(patch: NotePatch): void;
  /**
   * Edits the note with this id, active or not, without changing the active note; unknown ids
   * are ignored. Use it where the caller knows which note an edit belongs to (an editor bound to
   * one note), so an edit cannot land on another note while the active note is changing.
   */
  updateNote(id: string, patch: NotePatch): void;
}

export function useNotes(storage: NoteStorage, options: UseNotesOptions = {}): UseNotesResult {
  const now = useRef(options.now ?? Date.now).current;
  const saveDelayMs = options.saveDelayMs ?? SAVE_DELAY_MS;

  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);

  // Refs mirror the state so callbacks always see the latest values synchronously.
  const notesRef = useRef<Note[]>([]);
  const activeIdRef = useRef<string | undefined>(undefined);
  // Unsaved versions by note id: each edit replaces its note's entry, so edits to different
  // notes inside one debounce window are all written.
  const pendingRef = useRef(new Map<string, Note>());

  const commit = useCallback((next: Note[], nextActiveId: string | undefined) => {
    notesRef.current = next;
    activeIdRef.current = nextActiveId;
    setNotes(next);
    setActiveId(nextActiveId);
  }, []);

  // Writes every pending note. A failed write stays pending, so the next run retries it.
  const writePending = useCallback(() => {
    const batch = [...pendingRef.current.values()];
    pendingRef.current.clear();
    for (const note of batch) {
      storage.put(note).then(
        () => setSaveFailed(false),
        (error: unknown) => {
          console.error('Failed to save note', error);
          // Retry later only if this is still the latest version of a note that still
          // exists: a newer edit carries the whole note and is written on its own.
          const current = notesRef.current.find((n) => n.id === note.id);
          if (current === note && !pendingRef.current.has(note.id)) {
            pendingRef.current.set(note.id, note);
          }
          setSaveFailed(true);
        },
      );
    }
  }, [storage]);

  const saver = useMemo(() => debounce(writePending, saveDelayMs), [writePending, saveDelayMs]);

  /** Writes pending notes now; unlike saver.flush() it also retries failed writes. */
  const flushSaves = useCallback(() => {
    saver.cancel();
    writePending();
  }, [saver, writePending]);

  useEffect(() => {
    const flush = () => flushSaves();
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushSaves();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      flushSaves();
    };
  }, [flushSaves]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError(false);
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
    load().catch((error: unknown) => {
      console.error('Failed to load notes', error);
      if (cancelled) return;
      setLoadError(true);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [storage, now, commit, loadAttempt]);

  const retryLoad = useCallback(() => {
    setLoadError(false);
    setLoading(true);
    setLoadAttempt((n) => n + 1);
  }, []);

  const dismissSaveError = useCallback(() => setSaveFailed(false), []);

  const createNote = useCallback(async () => {
    flushSaves();
    const note = makeNote(now());
    await storage.put(note);
    commit(sortByUpdatedDesc([note, ...notesRef.current]), note.id);
    return note;
  }, [storage, now, flushSaves, commit]);

  const selectNote = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) return;
      if (!notesRef.current.some((n) => n.id === id)) return;
      flushSaves();
      commit(notesRef.current, id);
    },
    [flushSaves, commit],
  );

  const deleteNote = useCallback(
    async (id: string) => {
      const removed = notesRef.current.find((n) => n.id === id);
      // Unknown id, or this note is already being deleted.
      if (!removed) return;

      // Take the note out of memory before any await: once it is gone, updateActive
      // cannot target it, so no later save can write the deleted note back.
      const droppedEdit = pendingRef.current.delete(id);
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
        // unless it was edited meanwhile (an edit swaps in a new object). Edits made meanwhile
        // to the note that became active are written before the active note switches back.
        flushSaves();
        const kept = notesRef.current.filter((n) => n !== replacement);
        const activeAfter =
          activeIdRef.current === nextActiveId ? previousActiveId : activeIdRef.current;
        commit(sortByUpdatedDesc([removed, ...kept]), activeAfter);
        if (droppedEdit) {
          pendingRef.current.set(removed.id, removed);
          flushSaves();
        }
        throw error;
      }

      if (replacement) {
        // Edits may have landed on the replacement during the remove: store its latest
        // version (it replaces any pending older one).
        const latest = notesRef.current.find((n) => n.id === replacement.id);
        if (!latest) return;
        pendingRef.current.set(latest.id, latest);
        // The note is already deleted, so a failed store of the replacement must not reject:
        // it is reported and retried like a failed autosave.
        flushSaves();
      }
    },
    [storage, now, flushSaves, commit],
  );

  const updateNote = useCallback(
    (id: string, patch: NotePatch) => {
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
        activeIdRef.current,
      );
      pendingRef.current.set(updated.id, updated);
      saver();
    },
    [now, saver, commit],
  );

  const updateActive = useCallback(
    (patch: NotePatch) => {
      const id = activeIdRef.current;
      if (id !== undefined) updateNote(id, patch);
    },
    [updateNote],
  );

  const activeNote = useMemo(() => notes.find((n) => n.id === activeId), [notes, activeId]);

  return {
    notes,
    activeNote,
    loading,
    loadError,
    retryLoad,
    saveFailed,
    dismissSaveError,
    createNote,
    selectNote,
    deleteNote,
    updateActive,
    updateNote,
  };
}
