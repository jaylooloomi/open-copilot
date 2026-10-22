import { Blob as NodeBlob } from 'node:buffer';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectPlatform } from './selectPlatform';

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

// selectPlatform opens the default 'open-copilot' DB and Platform has no close(),
// so give every test a fresh fake IndexedDB instead of sharing notes across tests.
afterEach(() => {
  globalThis.indexedDB = new IDBFactory();
  delete window.ocDesktop;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('selectPlatform', () => {
  it('returns an IndexedDB-backed platform that can print', async () => {
    const platform = await selectPlatform();
    expect(platform.canPrint).toBe(true);
    expect(typeof platform.fileSaver.save).toBe('function');

    await platform.storage.put({
      id: 'n1',
      title: '測試',
      content: { type: 'doc' },
      createdAt: 1,
      updatedAt: 1,
    });
    expect(await platform.storage.list()).toEqual([
      expect.objectContaining({ id: 'n1', title: '測試' }),
    ]);
  });

  it('starts each test with an empty database', async () => {
    const platform = await selectPlatform();
    expect(await platform.storage.list()).toEqual([]);
  });

  it('saves through window.ocDesktop inside the Electron app', async () => {
    const saveFile = vi.fn(async (_filename: string, _bytes: Uint8Array) => true);
    window.ocDesktop = { saveFile };
    const platform = await selectPlatform();

    await platform.fileSaver.save('筆記.md', new NodeBlob(['# 筆記']) as unknown as Blob);

    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFile.mock.calls[0][0]).toBe('筆記.md');
    expect(new TextDecoder().decode(saveFile.mock.calls[0][1])).toBe('# 筆記');
    expect(platform.canPrint).toBe(true);
  });

  it('downloads through the browser when window.ocDesktop is absent', async () => {
    const platform = await selectPlatform();
    // jsdom has no object URLs and must not navigate; fake both (as in M1's browserFileSaver test).
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn((_blob: Blob) => 'blob:fake-url');
    URL.revokeObjectURL = vi.fn((_url: string) => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await platform.fileSaver.save('筆記.txt', new Blob(['內文']));

    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});
