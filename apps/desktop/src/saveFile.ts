import * as path from 'node:path';

/** IPC channel between preload.ts and main.ts. */
export const SAVE_FILE_CHANNEL = 'oc:save-file';

export interface FileFilter {
  name: string;
  extensions: string[];
}

/** The subset of Electron's SaveDialogOptions we use. */
export interface SaveDialogRequest {
  title: string;
  defaultPath: string;
  filters: FileFilter[];
}

export interface SaveFileDeps {
  showSaveDialog(request: SaveDialogRequest): Promise<{ canceled: boolean; filePath?: string }>;
  writeFile(filePath: string, data: Uint8Array): Promise<void>;
  /** Folder the dialog opens in, e.g. app.getPath('documents'). */
  defaultDir(): string;
}

const FILTERS: Record<string, FileFilter> = {
  md: { name: 'Markdown', extensions: ['md'] },
  docx: { name: 'Word 文件', extensions: ['docx'] },
  txt: { name: '純文字', extensions: ['txt'] },
  json: { name: 'JSON 備份', extensions: ['json'] },
};
const ALL_FILES: FileFilter = { name: '所有檔案', extensions: ['*'] };

/**
 * Handles `oc:save-file`: asks where to save with the native dialog, then writes the bytes.
 * Resolves true when written and false when the user cancels; invalid arguments throw.
 */
export function createSaveFileHandler(deps: SaveFileDeps) {
  return async function saveFile(filename: unknown, bytes: unknown): Promise<boolean> {
    if (typeof filename !== 'string' || filename.trim() === '') {
      throw new TypeError('filename must be a non-empty string');
    }
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('bytes must be a Uint8Array');
    }
    // The renderer only suggests a name; it never picks the folder.
    const name = path.basename(filename.replaceAll('\\', '/'));
    if (name.trim() === '' || name === '.' || name === '..') {
      throw new TypeError('filename must name a file');
    }
    const filter = FILTERS[path.extname(name).slice(1).toLowerCase()];

    const result = await deps.showSaveDialog({
      title: '另存新檔',
      defaultPath: path.join(deps.defaultDir(), name),
      filters: filter ? [filter, ALL_FILES] : [ALL_FILES],
    });
    if (result.canceled || !result.filePath) return false;

    await deps.writeFile(result.filePath, bytes);
    return true;
  };
}
