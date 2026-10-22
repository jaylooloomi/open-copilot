import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSaveFileHandler, SAVE_FILE_CHANNEL, type SaveDialogRequest } from './saveFile';

const DOCS = path.resolve('home', 'Documents');
const bytes = new TextEncoder().encode('# 週會紀錄\n');

function setup(result: { canceled: boolean; filePath?: string }) {
  const showSaveDialog = vi.fn(async (_request: SaveDialogRequest) => result);
  const writeFile = vi.fn(async (_filePath: string, _data: Uint8Array) => undefined);
  const saveFile = createSaveFileHandler({ showSaveDialog, writeFile, defaultDir: () => DOCS });
  return { saveFile, showSaveDialog, writeFile };
}

describe('createSaveFileHandler', () => {
  it('uses the oc:save-file channel', () => {
    expect(SAVE_FILE_CHANNEL).toBe('oc:save-file');
  });

  it('asks where to save, then writes the bytes there', async () => {
    const target = path.join(DOCS, '會議.md');
    const { saveFile, showSaveDialog, writeFile } = setup({ canceled: false, filePath: target });

    await expect(saveFile('週會紀錄.md', bytes)).resolves.toBe(true);

    expect(showSaveDialog).toHaveBeenCalledWith({
      title: '另存新檔',
      defaultPath: path.join(DOCS, '週會紀錄.md'),
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: '所有檔案', extensions: ['*'] },
      ],
    });
    expect(writeFile).toHaveBeenCalledWith(target, bytes);
  });

  it.each([
    ['報告.docx', 'Word 文件', 'docx'],
    ['筆記.txt', '純文字', 'txt'],
  ])('offers a matching file type filter for %s', async (filename, name, ext) => {
    const { saveFile, showSaveDialog } = setup({ canceled: true });
    await saveFile(filename, bytes);
    expect(showSaveDialog.mock.calls[0][0].filters[0]).toEqual({ name, extensions: [ext] });
  });

  it('returns false and writes nothing when the user cancels', async () => {
    const { saveFile, writeFile } = setup({ canceled: true, filePath: '' });
    await expect(saveFile('a.md', bytes)).resolves.toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('treats an empty path as cancelled', async () => {
    const { saveFile, writeFile } = setup({ canceled: false, filePath: '' });
    await expect(saveFile('a.md', bytes)).resolves.toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('keeps only the file name the renderer suggests', async () => {
    const { saveFile, showSaveDialog } = setup({ canceled: true });
    await saveFile('../../Windows/evil.md', bytes);
    await saveFile('..\\..\\Windows\\evil.md', bytes);
    expect(showSaveDialog).toHaveBeenCalledTimes(2);
    for (const [request] of showSaveDialog.mock.calls) {
      expect(request.defaultPath).toBe(path.join(DOCS, 'evil.md'));
    }
  });

  it('rejects arguments that did not come from desktopFileSaver', async () => {
    const { saveFile, showSaveDialog } = setup({ canceled: true });
    await expect(saveFile('', bytes)).rejects.toThrow('filename must be a non-empty string');
    await expect(saveFile(42, bytes)).rejects.toThrow('filename must be a non-empty string');
    await expect(saveFile('a.md', 'not bytes')).rejects.toThrow('bytes must be a Uint8Array');
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it('passes write failures on to the renderer', async () => {
    const { saveFile, writeFile } = setup({ canceled: false, filePath: path.join(DOCS, 'a.md') });
    writeFile.mockRejectedValueOnce(new Error('EACCES: permission denied'));
    await expect(saveFile('a.md', bytes)).rejects.toThrow('EACCES: permission denied');
  });
});
