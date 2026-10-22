import type { FileSaver } from '@oc/core';

/** The API apps/desktop/src/preload.ts exposes as `window.ocDesktop`. */
export interface OcDesktopBridge {
  /** Shows the native save dialog and writes the bytes; resolves false when the user cancels. */
  saveFile(filename: string, bytes: Uint8Array): Promise<boolean>;
}

/** Saves exports through Electron's native "Save as" dialog. */
export function createDesktopFileSaver(bridge: OcDesktopBridge): FileSaver {
  return {
    async save(filename, data) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      const saved = await bridge.saveFile(filename, bytes);
      // M2 convention: a cancelled dialog rejects with AbortError, and NoteActions stays quiet.
      if (!saved) throw new DOMException('使用者取消', 'AbortError');
    },
  };
}
