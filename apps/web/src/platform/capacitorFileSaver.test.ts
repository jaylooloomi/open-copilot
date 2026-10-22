import type { WriteFileOptions } from '@capacitor/filesystem';
import type { ShareOptions } from '@capacitor/share';
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  blobToBase64,
  createCapacitorFileSaver,
  EXPORT_DIR,
  SHARE_DIALOG_TITLE,
} from './capacitorFileSaver';

// The native plugins do not exist in jsdom; replace them with spies.
const { CACHE_URI, writeFile, share } = vi.hoisted(() => {
  const uri = 'file:///data/user/0/com.think4u.opencopilot/cache/exports/%E9%80%B1.md';
  return {
    CACHE_URI: uri,
    writeFile: vi.fn(async (_options: WriteFileOptions) => ({ uri })),
    share: vi.fn(async (_options: ShareOptions) => ({ activityType: 'com.google.android.gm' })),
  };
});
vi.mock('@capacitor/filesystem', () => ({ Directory: { Cache: 'CACHE' }, Filesystem: { writeFile } }));
vi.mock('@capacitor/share', () => ({ Share: { share } }));

const base64 = (bytes: string | Uint8Array) =>
  (typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes)).toString('base64');

afterEach(() => {
  // Back to the implementations above, dropping unused mock*Once values.
  writeFile.mockReset();
  share.mockReset();
});

describe('createCapacitorFileSaver', () => {
  it('writes the file into the app cache as base64, then opens the share sheet', async () => {
    const blob = new Blob(['# 週會紀錄\n'], { type: 'text/markdown;charset=utf-8' });
    await createCapacitorFileSaver().save('週會紀錄.md', blob);

    expect(writeFile).toHaveBeenCalledWith({
      path: `${EXPORT_DIR}/週會紀錄.md`,
      data: base64('# 週會紀錄\n'),
      directory: 'CACHE',
      recursive: true,
    });
    expect(share).toHaveBeenCalledWith({
      title: '週會紀錄.md',
      files: [CACHE_URI],
      dialogTitle: SHARE_DIALOG_TITLE,
    });
    expect(writeFile.mock.invocationCallOrder[0]).toBeLessThan(share.mock.invocationCallOrder[0]);
  });

  it('keeps binary files (Word) byte for byte', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80, 0x7f]);
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await createCapacitorFileSaver().save('週會紀錄.docx', blob);

    expect(writeFile.mock.calls[0][0].data).toBe(base64(bytes));
  });

  it.each([
    ['Android share sheet closed', new Error('Share canceled')],
    ['web share dialog closed', new DOMException('Share canceled', 'AbortError')],
  ])('turns a cancel (%s) into AbortError so NoteActions stays quiet', async (_case, error) => {
    share.mockRejectedValueOnce(error);
    await expect(
      createCapacitorFileSaver().save('a.txt', new Blob(['a'], { type: 'text/plain' })),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('passes other share failures on to the caller', async () => {
    share.mockRejectedValueOnce(new Error("Can't share while sharing is in progress"));
    const saving = createCapacitorFileSaver().save('a.txt', new Blob(['a']));
    await expect(saving).rejects.toThrow("Can't share while sharing is in progress");
    await expect(saving).rejects.not.toMatchObject({ name: 'AbortError' });
  });

  it('does not treat unrelated errors that mention "cancel" as a user cancel', async () => {
    share.mockRejectedValueOnce(new Error('Activity was cancelled by the system: FileProvider error'));
    const saving = createCapacitorFileSaver().save('a.txt', new Blob(['a']));
    await expect(saving).rejects.toThrow('FileProvider error');
    await expect(saving).rejects.not.toMatchObject({ name: 'AbortError' });
  });

  it.each(['../a.txt', 'sub/a.txt', 'sub\\a.txt', '..', '.', ''])(
    'refuses a filename that is not a plain file name (%j) without writing anything',
    async (filename) => {
      await expect(createCapacitorFileSaver().save(filename, new Blob(['a']))).rejects.toThrow();
      expect(writeFile).not.toHaveBeenCalled();
      expect(share).not.toHaveBeenCalled();
    },
  );

  it('does not open the share sheet when the file cannot be written', async () => {
    writeFile.mockRejectedValueOnce(new Error('No space left on device'));
    await expect(createCapacitorFileSaver().save('a.txt', new Blob(['a']))).rejects.toThrow(
      'No space left on device',
    );
    expect(share).not.toHaveBeenCalled();
  });
});

describe('blobToBase64', () => {
  it('encodes text and binary blobs without the data: URL prefix', async () => {
    expect(await blobToBase64(new Blob(['內文'], { type: 'text/plain;charset=utf-8' }))).toBe(
      base64('內文'),
    );
    expect(await blobToBase64(new Blob([new Uint8Array([0, 255])]))).toBe('AP8=');
  });

  it('encodes an empty blob as an empty string', async () => {
    expect(await blobToBase64(new Blob([]))).toBe('');
  });

  it('still returns an empty string where FileReader gives a bare "data:" (Chromium)', async () => {
    // Chromium's FileReader reads a zero-byte blob as "data:" (no comma); jsdom does not.
    const read = vi
      .spyOn(FileReader.prototype, 'readAsDataURL')
      .mockImplementation(function (this: FileReader) {
        Object.defineProperty(this, 'result', { configurable: true, value: 'data:' });
        this.dispatchEvent(new Event('load'));
      });
    try {
      expect(await blobToBase64(new Blob([]))).toBe('');
    } finally {
      read.mockRestore();
    }
  });
});
