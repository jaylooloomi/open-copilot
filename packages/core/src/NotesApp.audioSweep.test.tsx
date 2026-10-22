import { Blob as NodeBlob } from 'node:buffer';
import type { Note } from '@oc/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotesApp } from './NotesApp';
import { openAppDb } from './platform/db';
import { PlatformProvider } from './platform/PlatformContext';
import { createPendingQueue } from './recording/pendingQueue';
import { createTestPlatform } from './test/memoryStorage';

const gapDoc = (...gapIds: string[]): Note['content'] => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: gapIds.map((gapId) => ({ type: 'transcriptGap', attrs: { gapId, seq: 1 } })) }],
});
const note = (id: string, title: string, updatedAt: number, ...gapIds: string[]): Note => ({
  id,
  title,
  content: gapDoc(...gapIds),
  createdAt: 1,
  updatedAt,
});
const audio = (gapId: string, noteId: string) => ({
  gapId,
  noteId,
  seq: 1,
  blob: new NodeBlob(['x']) as unknown as Blob,
  mimeType: 'audio/webm',
  prompt: '',
});

afterEach(() => {
  vi.restoreAllMocks();
});

// NotesApp keeps one connection to the default database for the whole file, so both tests use
// distinct gap ids.
describe('NotesApp: kept audio of ⚠ markers', () => {
  it('drops, once the notes are loaded, the audio no saved note refers to any more', async () => {
    const queue = createPendingQueue(openAppDb());
    await queue.add(audio('kept', 'n1'));
    await queue.add(audio('retried', 'n1'));
    await queue.add(audio('of-deleted-note', 'gone'));
    const ctx = createTestPlatform([note('n1', '筆記', 1, 'kept')]);

    render(
      <PlatformProvider platform={ctx.platform}>
        <NotesApp />
      </PlatformProvider>,
    );
    await screen.findByRole('textbox', { name: '標題' });

    await waitFor(async () => expect(await queue.get('retried')).toBeUndefined());
    expect(await queue.get('of-deleted-note')).toBeUndefined();
    expect(await queue.get('kept')).toBeDefined();
  });

  it('deleting a note keeps the audio of a marker that was pasted into another note', async () => {
    const queue = createPendingQueue(openAppDb());
    const ctx = createTestPlatform([note('a', '甲', 2, 'pasted', 'only-a'), note('b', '乙', 1, 'pasted')]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <PlatformProvider platform={ctx.platform}>
        <NotesApp />
      </PlatformProvider>,
    );
    await screen.findByRole('textbox', { name: '標題' });
    // Added after the load-time sweep, which would otherwise keep both anyway.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await queue.add(audio('pasted', 'a'));
    await queue.add(audio('only-a', 'a'));

    await userEvent.setup().click(screen.getByRole('button', { name: '刪除「甲」' }));

    await waitFor(async () => expect(await queue.get('only-a')).toBeUndefined());
    expect(await queue.get('pasted')).toBeDefined();
  });
});
