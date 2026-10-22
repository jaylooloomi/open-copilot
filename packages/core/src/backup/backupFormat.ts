import type { JSONContent, Note } from '@oc/shared';
import { getSchema } from '@tiptap/react';
import { createExtensions } from '../editor/extensions';

export const BACKUP_APP = 'open-copilot';
export const BACKUP_VERSION = 1;
export const BACKUP_MIME = 'application/json';

/** The whole backup file: every note, without any recorded audio. */
export interface BackupFile {
  app: typeof BACKUP_APP;
  version: typeof BACKUP_VERSION;
  /** Epoch ms. */
  exportedAt: number;
  notes: Note[];
}

/** Thrown by parseBackup for anything that is not a valid open-copilot backup. */
export class InvalidBackupError extends Error {
  constructor(reason: string) {
    super(`Invalid backup: ${reason}`);
    this.name = 'InvalidBackupError';
  }
}

type Schema = ReturnType<typeof getSchema>;

let cachedSchema: Schema | undefined;

/** The editor's schema, built once on first use. */
function editorSchema(): Schema {
  cachedSchema ??= getSchema(createExtensions());
  return cachedSchema;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * A document the editor can open as is. Tiptap does not reject unknown nodes: it swaps in an
 * empty document, and the next edit would overwrite the imported note with it.
 */
function isEditorDoc(value: unknown): value is JSONContent {
  if (!isRecord(value) || value.type !== 'doc') return false;
  try {
    editorSchema().nodeFromJSON(value).check();
    return true;
  } catch {
    return false;
  }
}

function isNote(value: unknown): value is Note {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.trim() !== '' &&
    typeof value.title === 'string' &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt) &&
    isEditorDoc(value.content)
  );
}

/** Only the Note fields, so nothing else is written to storage or to the file. */
function pickNoteFields({ id, title, content, createdAt, updatedAt }: Note): Note {
  return { id, title, content, createdAt, updatedAt };
}

export function createBackup(notes: readonly Note[], exportedAt: number): BackupFile {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt, notes: notes.map(pickNoteFields) };
}

export function serializeBackup(backup: BackupFile): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** `open-copilot-backup-YYYYMMDD-HHmm.json`, in local time. */
export function backupFilename(date: Date): string {
  const day = `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `open-copilot-backup-${day}-${time}.json`;
}

/** Parses and validates a backup file's text; throws InvalidBackupError for anything else. */
export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try {
    // Windows editors often save JSON with a byte order mark, which JSON.parse rejects.
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new InvalidBackupError('not JSON');
  }
  if (!isRecord(data)) throw new InvalidBackupError('not an object');
  if (data.app !== BACKUP_APP) throw new InvalidBackupError('not an open-copilot backup');
  if (data.version !== BACKUP_VERSION) throw new InvalidBackupError('unsupported version');
  if (!isTimestamp(data.exportedAt)) throw new InvalidBackupError('exportedAt is not a number');
  if (!Array.isArray(data.notes)) throw new InvalidBackupError('notes is not an array');

  const ids = new Set<string>();
  const notes = data.notes.map((value: unknown, index: number) => {
    if (!isNote(value)) throw new InvalidBackupError(`note ${index} is malformed`);
    if (ids.has(value.id)) throw new InvalidBackupError(`note id ${value.id} appears twice`);
    ids.add(value.id);
    return pickNoteFields(value);
  });
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: data.exportedAt, notes };
}
