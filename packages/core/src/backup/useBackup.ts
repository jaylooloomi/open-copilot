import type { Note } from '@oc/shared';
import { useRef, useState } from 'react';
import type { ImportNotesResult } from '../notes/useNotes';
import { isAbortError } from '../platform/isAbortError';
import type { FileSaver } from '../platform/types';
import { BACKUP_MIME, backupFilename, createBackup, parseBackup, serializeBackup } from './backupFormat';
import { isBackupDue, loadLastBackupAt, saveLastBackupAt } from './backupReminder';

export const NOT_A_BACKUP_MESSAGE = '這不是 open-copilot 的備份檔';
export const BACKUP_FAILED_MESSAGE = '備份失敗，請再試一次。';
export const IMPORT_FAILED_MESSAGE = '匯入失敗，請再試一次。';
export const READ_FAILED_MESSAGE = '無法讀取檔案，請再試一次。';

export interface UseBackupOptions {
  /** The notes to back up, as shown (unsaved edits included). */
  notes: readonly Note[];
  fileSaver: FileSaver;
  /** Merges and stores the notes of a backup (useNotes.importNotes). */
  importNotes(incoming: readonly Note[]): Promise<ImportNotesResult>;
  /** Tells the user about a failure (`message`) and logs it (`error`). */
  onError(message: string, error: unknown): void;
  /** Clock for the backup time and the reminder; injectable for tests. */
  now?: () => number;
}

export interface UseBackupResult {
  /** Show the backup reminder instead of the usual banner. */
  backupDue: boolean;
  /** A backup or import is running; starting another one is ignored. */
  busy: boolean;
  /** Result of the last successful backup or import. */
  message: string | undefined;
  /** Saves every note as `open-copilot-backup-YYYYMMDD-HHmm.json`. Never rejects. */
  backup(): Promise<void>;
  /** Validates a chosen backup file and imports its notes. Never rejects. */
  importFile(file: Blob): Promise<void>;
}

/** Reads a file as UTF-8 text through FileReader (jsdom's Blob has no text()). */
export function readFileText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function useBackup({
  notes,
  fileSaver,
  importNotes,
  onError,
  now = Date.now,
}: UseBackupOptions): UseBackupResult {
  const [lastBackupAt, setLastBackupAt] = useState(loadLastBackupAt);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  // State updates land after the next render; the ref stops a second click right away.
  const busyRef = useRef(false);

  const run = async (task: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      await task();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const backup = () =>
    run(async () => {
      const at = now();
      const data = new Blob([serializeBackup(createBackup(notes, at))], { type: BACKUP_MIME });
      try {
        await fileSaver.save(backupFilename(new Date(at)), data);
      } catch (error) {
        // The user cancelled the save dialog: not a failure and not a backup.
        if (!isAbortError(error)) onError(BACKUP_FAILED_MESSAGE, error);
        return;
      }
      saveLastBackupAt(at);
      setLastBackupAt(at);
      setMessage(`已備份 ${notes.length} 篇筆記`);
    });

  const importFile = (file: Blob) =>
    run(async () => {
      let text: string;
      try {
        text = await readFileText(file);
      } catch (error) {
        onError(READ_FAILED_MESSAGE, error);
        return;
      }
      let incoming: Note[];
      try {
        incoming = parseBackup(text).notes;
      } catch (error) {
        onError(NOT_A_BACKUP_MESSAGE, error);
        return;
      }
      try {
        const { imported, skipped } = await importNotes(incoming);
        setMessage(`已匯入 ${imported} 篇，略過 ${skipped} 篇（本機版本較新）`);
      } catch (error) {
        onError(IMPORT_FAILED_MESSAGE, error);
      }
    });

  return { backupDue: isBackupDue(notes, lastBackupAt, now()), busy, message, backup, importFile };
}
