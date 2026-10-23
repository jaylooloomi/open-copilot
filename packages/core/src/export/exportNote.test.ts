import type { Note } from '@oc/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBlobText } from '../test/blob';
import { createTestPlatform } from '../test/memoryStorage';
import { exportNote } from './exportNote';
import { printPdf } from './printPdf';
import { toMarkdown } from './toMarkdown';
import { toTxt } from './toTxt';

vi.mock('./printPdf', () => ({ printPdf: vi.fn() }));

const NOTE: Note = {
  id: 'n1',
  title: '週會/紀錄',
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一點', marks: [{ type: 'bold' }] }] }],
  },
  createdAt: 1,
  updatedAt: 1,
};

afterEach(() => {
  vi.mocked(printPdf).mockReset();
});

describe('exportNote', () => {
  it('saves Markdown as <title>.md', async () => {
    const { platform, fileSaver } = createTestPlatform();
    await exportNote(NOTE, 'md', platform);

    expect(fileSaver.save).toHaveBeenCalledTimes(1);
    const [filename, blob] = fileSaver.save.mock.calls[0];
    expect(filename).toBe('週會紀錄.md');
    expect(blob.type).toBe('text/markdown;charset=utf-8');
    expect(await readBlobText(blob)).toBe(toMarkdown(NOTE));
  });

  it('saves plain text as <title>.txt', async () => {
    const { platform, fileSaver } = createTestPlatform();
    await exportNote(NOTE, 'txt', platform);

    const [filename, blob] = fileSaver.save.mock.calls[0];
    expect(filename).toBe('週會紀錄.txt');
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(await readBlobText(blob)).toBe(toTxt(NOTE));
  });

  it('saves a Word document as <title>.docx', async () => {
    const { platform, fileSaver } = createTestPlatform();
    await exportNote(NOTE, 'docx', platform);

    const [filename, blob] = fileSaver.save.mock.calls[0];
    expect(filename).toBe('週會紀錄.docx');
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('names untitled notes 未命名筆記', async () => {
    const { platform, fileSaver } = createTestPlatform();
    await exportNote({ ...NOTE, title: '' }, 'md', platform);
    expect(fileSaver.save.mock.calls[0][0]).toBe('未命名筆記.md');
  });

  it('prints for PDF instead of saving a file', async () => {
    const { platform, fileSaver } = createTestPlatform();
    await exportNote(NOTE, 'pdf', platform);

    expect(printPdf).toHaveBeenCalledWith(NOTE);
    expect(fileSaver.save).not.toHaveBeenCalled();
  });

  it('refuses PDF when the platform cannot print', async () => {
    const { platform } = createTestPlatform();
    await expect(exportNote(NOTE, 'pdf', { ...platform, canPrint: false })).rejects.toThrow(
      'PDF export is not available on this platform',
    );
    expect(printPdf).not.toHaveBeenCalled();
  });

  it('passes FileSaver failures on to the caller', async () => {
    const { platform, fileSaver } = createTestPlatform();
    fileSaver.save.mockRejectedValueOnce(new Error('disk full'));
    await expect(exportNote(NOTE, 'md', platform)).rejects.toThrow('disk full');
  });

  it('rejects an unknown format instead of silently doing nothing', async () => {
    const { platform, fileSaver } = createTestPlatform();
    await expect(exportNote(NOTE, 'rtf' as never, platform)).rejects.toThrow('Unknown export format: rtf');
    expect(fileSaver.save).not.toHaveBeenCalled();
    expect(printPdf).not.toHaveBeenCalled();
  });
});
