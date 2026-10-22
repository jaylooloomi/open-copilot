import type { JSONContent, Note } from '@oc/shared';

/** localStorage key holding the epoch ms of the last successful backup. */
export const LAST_BACKUP_KEY = 'oc.lastBackupAt';

/** Remind once the last backup is more than this old. */
export const BACKUP_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;

/** Nodes that hold nothing by themselves; any other node (heading, list, ⚠ marker) is content. */
const EMPTY_NODE_TYPES = new Set(['doc', 'paragraph', 'text', 'hardBreak']);

function isBlankNode(node: JSONContent): boolean {
  if (node.type !== undefined && !EMPTY_NODE_TYPES.has(node.type)) return false;
  if (typeof node.text === 'string' && node.text.trim() !== '') return false;
  return (node.content ?? []).every(isBlankNode);
}

/** No title and no body, like the note the app creates on first start. */
export function isBlankNote(note: Note): boolean {
  return note.title.trim() === '' && isBlankNode(note.content);
}

/**
 * True when some note has content and the last backup is more than 7 days old, or there has
 * never been one. Blank notes alone never remind. A backup time in the future (a clock change)
 * cannot be trusted, so it reminds too.
 */
export function isBackupDue(notes: readonly Note[], lastBackupAt: number | undefined, now: number): boolean {
  if (notes.every((note) => isBlankNote(note))) return false;
  return lastBackupAt === undefined || lastBackupAt > now || now - lastBackupAt > BACKUP_REMINDER_MS;
}

/** The last backup time, or undefined when there is none or it cannot be read. */
export function loadLastBackupAt(): number | undefined {
  try {
    const raw = localStorage.getItem(LAST_BACKUP_KEY);
    if (raw === null) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Records a successful backup; a storage failure is logged, never thrown. */
export function saveLastBackupAt(at: number): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(at));
  } catch (error) {
    console.error('Failed to save the last backup time', error);
  }
}
