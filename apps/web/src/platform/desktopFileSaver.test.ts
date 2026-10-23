import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { createDesktopFileSaver, type OcDesktopBridge } from './desktopFileSaver';

/** jsdom's Blob has no arrayBuffer(); Node's Blob stands in for the browser Blob. */
const blobOf = (text: string) => new NodeBlob([text], { type: 'text/markdown' }) as unknown as Blob;

function fakeBridge(result: boolean | Error) {
  const saveFile = vi.fn(async (_filename: string, _bytes: Uint8Array) => {
    if (result instanceof Error) throw result;
    return result;
  });
  const bridge: OcDesktopBridge = { saveFile };
  return { bridge, saveFile };
}

describe('createDesktopFileSaver', () => {
  it('sends the filename and the blob bytes to the native save dialog', async () => {
    const { bridge, saveFile } = fakeBridge(true);
    await createDesktopFileSaver(bridge).save('週會紀錄.md', blobOf('# 週會紀錄\n'));

    expect(saveFile).toHaveBeenCalledTimes(1);
    const [filename, bytes] = saveFile.mock.calls[0];
    expect(filename).toBe('週會紀錄.md');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes)).toBe('# 週會紀錄\n');
  });

  it('rejects with AbortError when the user cancels the dialog', async () => {
    const { bridge } = fakeBridge(false);
    await expect(createDesktopFileSaver(bridge).save('a.txt', blobOf('a'))).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('passes other failures on to the caller', async () => {
    const { bridge } = fakeBridge(new Error('EACCES: permission denied'));
    await expect(createDesktopFileSaver(bridge).save('a.txt', blobOf('a'))).rejects.toThrow(
      'EACCES: permission denied',
    );
  });
});
