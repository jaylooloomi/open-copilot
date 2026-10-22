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

  it('edits made while deleting the last note never write it back', async () => {
    const { result, storage, notes } = await setup([note('a', 1)]);
    const removed = deferred();
    const putStarted = deferred();
    const saved = deferred();
    storage.remove.mockImplementationOnce(async (id: string) => {
      await removed.promise;
      notes.delete(id);
    });
    storage.put.mockImplementationOnce(async (n: Note) => {
      putStarted.resolve();
      await saved.promise;
      notes.set(n.id, structuredClone(n));
    });

    let deleting!: Promise<void>;
    act(() => {
      deleting = result.current.deleteNote('a');
    });
    act(() => result.current.updateActive({ title: 'typed during remove' }));
    await act(async () => {
      removed.resolve();
      await putStarted.promise;
    });
    act(() => result.current.updateActive({ title: 'typed during save' }));
    await act(async () => {
      saved.resolve();
      await deleting;
    });
    act(() => vi.advanceTimersByTime(1000));

    expect(storage.put).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    const fresh = result.current.activeNote;
    expect(fresh).toMatchObject({ title: '' });
    expect(result.current.notes).toEqual([fresh]);
    expect([...notes.values()]).toEqual([fresh]);
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
});
