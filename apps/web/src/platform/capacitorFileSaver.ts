import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { FileSaver } from '@oc/core';

/** Exports are written to <app cache>/exports/ before they are shared. */
export const EXPORT_DIR = 'exports';
/** Title of Android's share sheet. */
export const SHARE_DIALOG_TITLE = '分享匯出的筆記';

/**
 * Saves exports in the Capacitor app: the file goes into the app's cache directory, then the
 * system share sheet lets the user send it to Drive, Gmail, LINE, Files…
 */
export function createCapacitorFileSaver(): FileSaver {
  return {
    async save(filename, data) {
      // Native Filesystem.writeFile takes binary data only as base64 (Blob is web-only).
      const { uri } = await Filesystem.writeFile({
        path: `${EXPORT_DIR}/${filename}`,
        data: await blobToBase64(data),
        directory: Directory.Cache,
        recursive: true,
      });
      try {
        await Share.share({ title: filename, files: [uri], dialogTitle: SHARE_DIALOG_TITLE });
      } catch (error) {
        // M2 convention: closing the share sheet is a cancel, not a failure.
        if (isShareCancel(error)) throw new DOMException('使用者取消', 'AbortError');
        throw error;
      }
    },
  };
}

/** The blob as base64, without the `data:…;base64,` prefix. */
export function blobToBase64(blob: Blob): Promise<string> {
  // An empty note exports to an empty blob. Chromium reads that as a bare "data:" (no comma),
  // which Filesystem.writeFile on Android cannot decode.
  if (blob.size === 0) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const comma = dataUrl.indexOf(',');
      resolve(comma === -1 ? '' : dataUrl.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Android's Share plugin rejects with "Share canceled"; navigator.share with an AbortError. */
function isShareCancel(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  return name === 'AbortError' || (typeof message === 'string' && /cancel/i.test(message));
}
