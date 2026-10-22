import type { Note } from '@oc/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readBlobText } from '../test/blob';
import { copyNote } from './copyNote';

const NOTE: Note = {
  id: 'n1',
  title: '週會',
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一點', marks: [{ type: 'bold' }] }] }],
  },
  createdAt: 1,
  updatedAt: 1,
};

/** jsdom has no ClipboardItem; this fake keeps the blobs it was given. */
class FakeClipboardItem {
  constructor(readonly items: Record<string, Blob>) {}
}

function installClipboard(clipboard: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
}

beforeEach(() => {
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
});

afterEach(() => {
  vi.unstubAllGlobals();
  // jsdom has no navigator.clipboard of its own; drop the one a test installed.
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('copyNote', () => {
  it('writes HTML and plain text in one clipboard item', async () => {
    const write = vi.fn(async (_items: ClipboardItems) => undefined);
    const writeText = vi.fn(async (_text: string) => undefined);
    installClipboard({ write, writeText });

    await copyNote(NOTE);

    expect(writeText).not.toHaveBeenCalled();
    const [[items]] = write.mock.calls;
    expect(items).toHaveLength(1);
    const { items: blobs } = items[0] as unknown as FakeClipboardItem;
    expect(Object.keys(blobs).sort()).toEqual(['text/html', 'text/plain']);
    expect(await readBlobText(blobs['text/html'])).toBe('<h1>週會</h1><p><strong>第一點</strong></p>');
    expect(await readBlobText(blobs['text/plain'])).toBe('週會\n\n第一點');
  });

  it('falls back to plain text when the rich write is refused', async () => {
    const write = vi.fn(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    const writeText = vi.fn(async (_text: string) => undefined);
    installClipboard({ write, writeText });

    await copyNote(NOTE);

    expect(writeText).toHaveBeenCalledWith('週會\n\n第一點');
  });

  it('uses plain text directly when ClipboardItem is not supported', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    const write = vi.fn(async () => undefined);
    const writeText = vi.fn(async (_text: string) => undefined);
    installClipboard({ write, writeText });

    await copyNote(NOTE);

    expect(write).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith('週會\n\n第一點');
  });

  it('rejects when plain text cannot be written either', async () => {
    installClipboard({
      write: vi.fn(async () => {
        throw new Error('rich failed');
      }),
      writeText: vi.fn(async () => {
        throw new Error('plain failed');
      }),
    });
    await expect(copyNote(NOTE)).rejects.toThrow('plain failed');
  });

  it('rejects when there is no clipboard at all', async () => {
    installClipboard(undefined);
    await expect(copyNote(NOTE)).rejects.toThrow('Clipboard API is not available');
  });
});
