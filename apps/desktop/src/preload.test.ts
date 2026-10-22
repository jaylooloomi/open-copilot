import { contextBridge, ipcRenderer } from 'electron';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SAVE_FILE_CHANNEL } from './saveFile';

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(async () => true) },
}));

type Bridge = { saveFile(filename: string, bytes: Uint8Array): Promise<boolean> };

describe('preload', () => {
  let bridge: Bridge;

  beforeAll(async () => {
    await import('./preload');
    bridge = vi.mocked(contextBridge.exposeInMainWorld).mock.calls[0][1] as Bridge;
  });

  it('exposes only saveFile, as window.ocDesktop', () => {
    expect(contextBridge.exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(vi.mocked(contextBridge.exposeInMainWorld).mock.calls[0][0]).toBe('ocDesktop');
    expect(Object.keys(bridge)).toEqual(['saveFile']);
  });

  it('forwards saveFile to the main process over oc:save-file', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.mocked(ipcRenderer.invoke).mockClear();
    await expect(bridge.saveFile('筆記.md', bytes)).resolves.toBe(true);
    expect(ipcRenderer.invoke).toHaveBeenCalledTimes(1);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(SAVE_FILE_CHANNEL, '筆記.md', bytes);
  });
});
