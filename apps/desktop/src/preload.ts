import { contextBridge, ipcRenderer } from 'electron';

// A sandboxed preload can only require('electron'), so the channel name is repeated here instead
// of being imported from saveFile.ts; preload.test.ts checks that both stay the same.
const SAVE_FILE_CHANNEL = 'oc:save-file';

contextBridge.exposeInMainWorld('ocDesktop', {
  saveFile: (filename: string, bytes: Uint8Array): Promise<boolean> =>
    ipcRenderer.invoke(SAVE_FILE_CHANNEL, filename, bytes),
});
