export { NotesApp } from './NotesApp';
export { PlatformProvider, usePlatform } from './platform/PlatformContext';
export { openAppDb, APP_DB_VERSION } from './platform/db';
export type { AppDbSchema, PendingSegmentRecord } from './platform/db';
export { createIndexedDbStorage } from './platform/indexedDbStorage';
export { createBrowserFileSaver } from './platform/browserFileSaver';
export type { FileSaver, NoteStorage, Platform } from './platform/types';
