import type { WriteFileOptions } from '@capacitor/filesystem';
import type { ShareOptions } from '@capacitor/share';
import { Blob as NodeBlob } from 'node:buffer';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectPlatform } from './selectPlatform';

// Outside the Android app Capacitor reports a web platform; tests opt in per call.
const { isNativePlatform, writeFile, rmdir, share } = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  writeFile: vi.fn(async (_options: WriteFileOptions) => ({ uri: 'file:///cache/exports/筆記.md' })),
  rmdir: vi.fn(async () => undefined),
  share: vi.fn(async (_options: ShareOptions) => ({})),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform } }));
vi.mock('@capacitor/filesystem', () => ({ Directory: { Cache: 'CACHE' }, Filesystem: { writeFile, rmdir } }));
vi.mock('@capacitor/share', () => ({ Share: { share } }));

// The guard adds 'pause' and 'visibilitychange' listeners to the real jsdom document, and
// selectPlatform drops its remover (production installs it once per page). Keep each remover
// so afterEach can take the guard off again.
const guardRemovers = vi.hoisted(() => [] as Array<() => void>);
vi.mock('./backgroundMicGuard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./backgroundMicGuard')>();
  return {
    ...actual,
    installBackgroundMicGuard: (...args: Parameters<typeof actual.installBackgroundMicGuard>) => {
      const remove = actual.installBackgroundMicGuard(...args);
      guardRemovers.push(remove);
      return remove;
    },
  };
});

/** jsdom has no navigator.mediaDevices; install one that hands out a single fake mic track. */
function installFakeMicrophone() {
  const track = Object.assign(new EventTarget(), {
    kind: 'audio',
    readyState: 'live' as MediaStreamTrackState,
    stop: vi.fn(() => {
      track.readyState = 'ended';
    }),
  });
  const getUserMedia = vi.fn(
    async (_constraints?: MediaStreamConstraints) =>
      ({ getTracks: () => [track], getAudioTracks: () => [track] }) as unknown as MediaStream,
  );
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  return { track, getUserMedia };
}

// selectPlatform opens the default 'open-copilot' DB and Platform has no close(),
// so give every test a fresh fake IndexedDB instead of sharing notes across tests.
afterEach(() => {
  for (const remove of guardRemovers.splice(0)) remove();
  globalThis.indexedDB = new IDBFactory();
  delete window.ocDesktop;
  Reflect.deleteProperty(navigator, 'mediaDevices');
  // Back to the vi.fn() implementations above, dropping unused mockReturnValueOnce values.
  isNativePlatform.mockReset();
  writeFile.mockReset();
  share.mockReset();
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
    expect(writeFile).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });

  it('downloads exports through the browser outside the Android app', async () => {
    // jsdom has no object URLs; fake them and catch the download link click.
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:fake-url');
    const revokeObjectURL = vi.fn((_url: string) => {});
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      const platform = await selectPlatform();
      // Only the delayed revoke; fake-indexeddb needs the real scheduler above.
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      const blob = new Blob(['# 筆記'], { type: 'text/markdown' });
      await platform.fileSaver.save('筆記.md', blob);
      vi.runAllTimers();

      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(click).toHaveBeenCalledTimes(1);
      expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('筆記.md');
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
      expect(writeFile).not.toHaveBeenCalled();
      expect(share).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      click.mockRestore();
      Reflect.deleteProperty(URL, 'createObjectURL');
      Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it('shares exports and hides PDF inside the Android app', async () => {
    isNativePlatform.mockReturnValueOnce(true);
    const platform = await selectPlatform();

    expect(platform.canPrint).toBe(false);
    await platform.fileSaver.save('筆記.md', new Blob(['# 筆記'], { type: 'text/markdown' }));

    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'exports/筆記.md', directory: 'CACHE' }),
    );
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ files: ['file:///cache/exports/筆記.md'] }),
    );
  });

  it('inside the Android app, ends the microphone when the app goes to the background', async () => {
    const mic = installFakeMicrophone();
    isNativePlatform.mockReturnValueOnce(true);
    await selectPlatform();

    await navigator.mediaDevices.getUserMedia({ audio: true });
    document.dispatchEvent(new Event('pause'));

    expect(mic.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(mic.track.stop).toHaveBeenCalledTimes(1);
    expect(guardRemovers).toHaveLength(1);
  });

  it('leaves getUserMedia alone in browsers', async () => {
    const mic = installFakeMicrophone();
    await selectPlatform();
    expect(navigator.mediaDevices.getUserMedia).toBe(mic.getUserMedia);
  });
});
