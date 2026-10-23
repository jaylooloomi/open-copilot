import type { Note } from '@oc/shared';

export interface NoteStorage {
  /** All notes, newest `updatedAt` first. */
  list(): Promise<Note[]>;
  get(id: string): Promise<Note | undefined>;
  put(note: Note): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface FileSaver {
  save(filename: string, data: Blob): Promise<void>;
}

export interface Platform {
  storage: NoteStorage;
  fileSaver: FileSaver;
  /** false hides "匯出 PDF" (Android WebView has no window.print). */
  canPrint: boolean;
}
