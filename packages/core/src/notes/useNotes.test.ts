import { EMPTY_DOC, type Note } from '@oc/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../test/memoryStorage';
import { useNotes } from './useNotes';

const note = (id: string, updatedAt: number, title = id): Note => ({
  id,
  title,
  content: EMPTY_DOC,
  createdAt: updatedAt,
  updatedAt,
});

/** A promise plus its resolver, for holding a storage call open mid-operation. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Renders useNotes with a manual clock, waits for the initial load, then fakes timers. */
async function setup(initial: Note[] = []) {
  const { storage, notes } = createMemoryStorage(initial);
  let clock = 10_000;
  const now = () => clock;
  const tick = (ms = 1) => {
    clock += ms;
  };
  const hook = renderHook(() => useNotes(storage, { now }));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  vi.useFakeTimers();
  storage.put.mockClear();
  storage.remove.mockClear();
  return { storage, notes, tick, ...hook };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useNotes', () => {
  it('creates and persists a first note when storage is empty', async () => {
    const { storage } = createMemoryStorage();
    const { result } = renderHook(() => useNotes(storage, { now: () => 5 }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.notes).toHaveLength(1);
    expect(result.current.activeNote).toMatchObject({ title: '', createdAt: 5, updatedAt: 5 });
    expect(storage.put).toHaveBeenCalledWith(result.current.activeNote);
  });

  it('loads existing notes newest first and activates the newest', async () => {
    const { result } = await setup([note('a', 1), note('b', 2)]);
    expect(result.current.notes.map((n) => n.id)).toEqual(['b', 'a']);
    expect(result.current.activeNote?.id).toBe('b');
  });

  it('updateActive changes memory at once and saves after 500ms without edits', async () => {
    const { result, storage, tick } = await setup([note('a', 1)]);
    tick(100);
    act(() => result.current.updateActive({ title: '會議紀錄' }));

    expect(result.current.activeNote).toMatchObject({ title: '會議紀錄', updatedAt: 10_100 });
    act(() => vi.advanceTimersByTime(499));
    expect(storage.put).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', title: '會議紀錄' }));
  });

  it('coalesces rapid edits into one write with the latest title and content', async () => {
    const { result, storage } = await setup([note('a', 1)]);
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '內文' }] }] };
    act(() => result.current.updateActive({ title: 'x' }));
    act(() => result.current.updateActive({ title: 'xy' }));
    act(() => result.current.updateActive({ content }));
    act(() => vi.advanceTimersByTime(500));

    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ title: 'xy', content }));
  });

  it('moves the edited note to the top of the list', async () => {
    const { result, tick } = await setup([note('a', 1), note('b', 2)]);
    act(() => result.current.selectNote('a'));
    tick();
    act(() => result.current.updateActive({ title: 'A2' }));
    expect(result.current.notes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('selectNote flushes the pending save of the previous note', async () => {
    const { result, storage } = await setup([note('a', 1), note('b', 2)]);
    act(() => result.current.updateActive({ title: 'B2' }));
    act(() => result.current.selectNote('a'));

    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', title: 'B2' }));
    expect(result.current.activeNote?.id).toBe('a');
  });

  it('createNote flushes pending edits, persists a new empty note and activates it', async () => {
    const { result, storage, tick } = await setup([note('a', 1)]);
    act(() => result.current.updateActive({ title: 'A2' }));
    tick();
    await act(async () => {
      await result.current.createNote();
    });

    const created = result.current.activeNote;
    expect(created).toMatchObject({ title: '', content: EMPTY_DOC });
    expect(created?.id).not.toBe('a');
    expect(result.current.notes.map((n) => n.id)).toEqual([created?.id, 'a']);
    expect(storage.put.mock.calls.map(([n]) => n.title)).toEqual(['A2', '']);
  });

  it('deleteNote removes the note and activates the newest remaining one', async () => {
    const { result, storage } = await setup([note('a', 1), note('b', 2), note('c', 3)]);
    await act(async () => {
      await result.current.deleteNote('c');
    });

    expect(storage.remove).toHaveBeenCalledWith('c');
    expect(result.current.notes.map((n) => n.id)).toEqual(['b', 'a']);
    expect(result.current.activeNote?.id).toBe('b');
  });

  it('deleting an inactive note keeps the active note', async () => {
    const { result } = await setup([note('a', 1), note('b', 2)]);
    await act(async () => {
      await result.current.deleteNote('a');
    });
    expect(result.current.activeNote?.id).toBe('b');
  });

  it('deleting the last note creates a fresh empty note', async () => {
    const { result, storage } = await setup([note('a', 1)]);
    await act(async () => {
      await result.current.deleteNote('a');
    });

    expect(result.current.notes).toHaveLength(1);
    expect(result.current.activeNote?.id).not.toBe('a');
    expect(result.current.activeNote?.title).toBe('');
    expect(storage.put).toHaveBeenCalledWith(result.current.activeNote);
  });

  it('deleting the active note drops its pending save', async () => {
    const { result, storage } = await setup([note('a', 1), note('b', 2)]);
    act(() => result.current.updateActive({ title: 'gone' }));
    await act(async () => {
      await result.current.deleteNote('b');
    });
    act(() => vi.advanceTimersByTime(1000));
    expect(storage.put).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'gone' }));
  });

  it('an edit made while a delete is in flight never writes the deleted note back', async () => {
    const { result, storage, notes } = await setup([note('a', 1), note('b', 2)]);
    const removed = deferred();
    storage.remove.mockImplementationOnce(async (id: string) => {
      await removed.promise;
      notes.delete(id);
    });

    let deleting!: Promise<void>;
    act(() => {
      deleting = result.current.deleteNote('b');
    });
    act(() => result.current.updateActive({ title: 'late edit' }));
    await act(async () => {
      removed.resolve();
      await deleting;
    });
    act(() => vi.advanceTimersByTime(1000));

    expect(storage.put).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
    expect([...notes.keys()]).toEqual(['a']);
    // The edit lands on the note that became active when 'b' left the list.
    expect(notes.get('a')?.title).toBe('late edit');
    expect(result.current.notes.map((n) => n.id)).toEqual(['a']);
  });

  it('shows the replacement at once while the last note is being deleted', async () => {
    const { result, storage, notes } = await setup([note('a', 1)]);
    const removed = deferred();
    storage.remove.mockImplementationOnce(async (id: string) => {
      await removed.promise;
      notes.delete(id);
    });

    let deleting!: Promise<void>;
    act(() => {
      deleting = result.current.deleteNote('a');
    });
    const fresh = result.current.activeNote;
    expect(fresh).toMatchObject({ title: '', content: EMPTY_DOC });
    expect(fresh?.id).not.toBe('a');
    expect(result.current.notes).toEqual([fresh]);

    await act(async () => {
      removed.resolve();
      await deleting;
    });
    expect(result.current.activeNote).toBe(fresh);
    expect([...notes.values()]).toEqual([fresh]);
  });

  it('edits made while deleting the last note land on the replacement, never on it', async () => {
    const { result, storage, notes } = await setup([note('a', 1)]);
    const removed = deferred();
    storage.remove.mockImplementationOnce(async (id: string) => {
      await removed.promise;
      notes.delete(id);
    });

    let deleting!: Promise<void>;
    act(() => {
      deleting = result.current.deleteNote('a');
    });
    const freshId = result.current.activeNote?.id ?? '';
    act(() => result.current.updateActive({ title: 'typed during remove' }));
    // The debounced save of that edit runs before the remove finishes.
    act(() => vi.advanceTimersByTime(500));
    act(() => result.current.updateActive({ title: 'typed again' }));
    await act(async () => {
      removed.resolve();
      await deleting;
    });

    // The replacement's latest version is stored by the time deleteNote resolves.
    expect(notes.get(freshId)?.title).toBe('typed again');
    act(() => vi.advanceTimersByTime(1000));
    expect(storage.put).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    expect([...notes.keys()]).toEqual([freshId]);
    expect(notes.get(freshId)?.title).toBe('typed again');
    expect(result.current.notes.map((n) => n.title)).toEqual(['typed again']);
  });

  it('deleting the same note twice removes it once and leaves one replacement', async () => {
    const { result, storage, notes } = await setup([note('a', 1)]);
    await act(async () => {
      await Promise.all([result.current.deleteNote('a'), result.current.deleteNote('a')]);
    });

    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(result.current.notes).toHaveLength(1);
    expect(notes.size).toBe(1);
  });

  it('deleteNote ignores ids that are not in the list', async () => {
    const { result, storage } = await setup([note('a', 1)]);
    await act(async () => {
      await result.current.deleteNote('missing');
    });

    expect(storage.remove).not.toHaveBeenCalled();
    expect(result.current.notes.map((n) => n.id)).toEqual(['a']);
  });

  it('a failed remove puts the note back and rejects', async () => {
    const { result, storage, notes } = await setup([note('a', 1), note('b', 2)]);
    storage.remove.mockRejectedValueOnce(new Error('idb fail'));
    await act(async () => {
      await expect(result.current.deleteNote('b')).rejects.toThrow('idb fail');
    });

    expect(result.current.notes.map((n) => n.id)).toEqual(['b', 'a']);
    expect(result.current.activeNote?.id).toBe('b');
    expect([...notes.keys()].sort()).toEqual(['a', 'b']);
  });

  it('a failed remove saves the edit it had dropped', async () => {
    const { result, storage, notes } = await setup([note('a', 1), note('b', 2)]);
    storage.remove.mockRejectedValueOnce(new Error('idb fail'));
    act(() => result.current.updateActive({ title: 'unsaved' }));
    await act(async () => {
      await expect(result.current.deleteNote('b')).rejects.toThrow('idb fail');
    });
    act(() => vi.advanceTimersByTime(1000));

    expect(result.current.activeNote).toMatchObject({ id: 'b', title: 'unsaved' });
    expect(notes.get('b')?.title).toBe('unsaved');
  });

  it('a failed remove of the last note restores it and drops the unused replacement', async () => {
    const { result, storage, notes } = await setup([note('a', 1)]);
    storage.remove.mockRejectedValueOnce(new Error('idb fail'));
    await act(async () => {
      await expect(result.current.deleteNote('a')).rejects.toThrow('idb fail');
    });

    expect(result.current.notes.map((n) => n.id)).toEqual(['a']);
    expect(result.current.activeNote?.id).toBe('a');
    expect(storage.put).not.toHaveBeenCalled();
    expect([...notes.keys()]).toEqual(['a']);
  });

  it('a failed remove of the last note keeps a replacement that was edited meanwhile', async () => {
    const { result, storage, notes } = await setup([note('a', 1)]);
    const failing = deferred();
    storage.remove.mockImplementationOnce(async () => {
      await failing.promise;
      throw new Error('idb fail');
    });

    let deleting!: Promise<void>;
    act(() => {
      deleting = result.current.deleteNote('a');
    });
    const freshId = result.current.activeNote?.id ?? '';
    act(() => result.current.updateActive({ title: 'new text' }));
    await act(async () => {
      failing.resolve();
      await expect(deleting).rejects.toThrow('idb fail');
    });
    act(() => vi.advanceTimersByTime(1000));

    expect(result.current.notes.map((n) => n.id)).toEqual([freshId, 'a']);
    expect(result.current.activeNote?.id).toBe('a');
    expect(notes.get(freshId)?.title).toBe('new text');
    expect(notes.has('a')).toBe(true);
  });

  it('deleting the last note resolves even when its replacement cannot be stored', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result, storage, notes } = await setup([note('a', 1)]);
    storage.put.mockRejectedValueOnce(new Error('quota'));
    await act(async () => {
      await result.current.deleteNote('a');
    });

    // The note is gone, so there is nothing to retry: only the failed store is logged.
    expect(notes.has('a')).toBe(false);
    expect(result.current.notes).toHaveLength(1);
    const freshId = result.current.activeNote?.id ?? '';
    expect(freshId).not.toBe('a');
    expect(consoleError).toHaveBeenCalledWith('Failed to save note', expect.any(Error));

    // The replacement stays in memory, and its next edit stores it.
    act(() => result.current.updateActive({ title: 'later' }));
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(notes.get(freshId)?.title).toBe('later');
  });

  it('flushes the pending save on unmount', async () => {
    const { result, storage, unmount } = await setup([note('a', 1)]);
    act(() => result.current.updateActive({ title: 'bye' }));
    unmount();
    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ title: 'bye' }));
  });

  it('flushes the pending save when the page is hidden', async () => {
    const { result, storage } = await setup([note('a', 1)]);
    act(() => result.current.updateActive({ title: 'hidden' }));
    window.dispatchEvent(new Event('pagehide'));
    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ title: 'hidden' }));
  });

  it('flushes the pending save when the document becomes hidden', async () => {
    const { result, storage } = await setup([note('a', 1)]);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      act(() => result.current.updateActive({ title: 'backgrounded' }));
      document.dispatchEvent(new Event('visibilitychange'));
      expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ title: 'backgrounded' }));
    } finally {
      visibility.mockRestore();
    }
  });

  it('keeps the save debounced when the document becomes visible', async () => {
    const { result, storage } = await setup([note('a', 1)]);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    try {
      act(() => result.current.updateActive({ title: 'still here' }));
      document.dispatchEvent(new Event('visibilitychange'));
      expect(storage.put).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(500));
      expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ title: 'still here' }));
    } finally {
      visibility.mockRestore();
    }
  });
});
