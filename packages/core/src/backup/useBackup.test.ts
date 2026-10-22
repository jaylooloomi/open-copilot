import { EMPTY_DOC, type JSONContent, type Note } from '@oc/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBlobText } from '../test/blob';
import { createBackup, InvalidBackupError, serializeBackup } from './backupFormat';
import { BACKUP_REMINDER_MS, LAST_BACKUP_KEY } from './backupReminder';
import {
  BACKUP_FAILED_MESSAGE,
  IMPORT_FAILED_MESSAGE,
  NOT_A_BACKUP_MESSAGE,
  useBackup,
  type UseBackupOptions,
} from './useBackup';

const NOW = new Date(2026, 9, 22, 9, 5).getTime();

const doc = (text: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const note = (id: string, text: string, updatedAt = 1_000): Note => ({
  id,
  title: id,
  content: doc(text),
  createdAt: updatedAt,
  updatedAt,
});

const blank: Note = { id: 'blank', title: '', content: EMPTY_DOC, createdAt: 1, updatedAt: 1 };

function setup(overrides: Partial<UseBackupOptions> = {}) {
  const save = vi.fn(async (_filename: string, _data: Blob) => undefined);
  const importNotes = vi.fn(async (_incoming: readonly Note[]) => ({
    imported: 0,
    skipped: 0,
    replacedActive: false,
  }));
  const onError = vi.fn();
  const options: UseBackupOptions = {
    notes: [note('a', '內容')],
    fileSaver: { save },
    importNotes,
    onError,
    now: () => NOW,
    ...overrides,
  };
  return { ...renderHook(() => useBackup(options)), save, importNotes, onError };
}

const jsonFile = (text: string) => new File([text], 'backup.json', { type: 'application/json' });

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useBackup reminder', () => {
  it('is due when there is a note with content and no backup yet', () => {
    expect(setup().result.current.backupDue).toBe(true);
  });

  it('is not due when every note is blank', () => {
    expect(setup({ notes: [blank] }).result.current.backupDue).toBe(false);
  });

  it('is due again only more than 7 days after the last backup', () => {
    localStorage.setItem(LAST_BACKUP_KEY, String(NOW - BACKUP_REMINDER_MS));
    expect(setup().result.current.backupDue).toBe(false);
    localStorage.setItem(LAST_BACKUP_KEY, String(NOW - BACKUP_REMINDER_MS - 1));
    expect(setup().result.current.backupDue).toBe(true);
  });
});

describe('useBackup backup', () => {
  it('saves every note as a dated JSON file and records the time', async () => {
    const { result, save } = setup();

    await act(() => result.current.backup());

    expect(save).toHaveBeenCalledTimes(1);
    const [filename, data] = save.mock.calls[0]!;
    expect(filename).toBe('open-copilot-backup-20261022-0905.json');
    expect(data.type).toBe('application/json');
    expect(JSON.parse(await readBlobText(data))).toEqual({
      app: 'open-copilot',
      version: 1,
      exportedAt: NOW,
      notes: [note('a', '內容')],
    });
    expect(localStorage.getItem(LAST_BACKUP_KEY)).toBe(String(NOW));
    expect(result.current.backupDue).toBe(false);
    expect(result.current.message).toBe('已備份 1 篇筆記');
    expect(result.current.busy).toBe(false);
  });

  it('reports a failed save and keeps reminding', async () => {
    const { result, save, onError } = setup();
    const failure = new Error('denied');
    save.mockRejectedValueOnce(failure);

    await act(() => result.current.backup());

    expect(onError).toHaveBeenCalledWith(BACKUP_FAILED_MESSAGE, failure);
    expect(localStorage.getItem(LAST_BACKUP_KEY)).toBeNull();
    expect(result.current.backupDue).toBe(true);
    expect(result.current.message).toBeUndefined();
  });

  it('treats a cancelled save dialog as neither a failure nor a backup', async () => {
    const { result, save, onError } = setup();
    save.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));

    await act(() => result.current.backup());

    expect(onError).not.toHaveBeenCalled();
    expect(localStorage.getItem(LAST_BACKUP_KEY)).toBeNull();
    expect(result.current.backupDue).toBe(true);
    expect(result.current.message).toBeUndefined();
    expect(result.current.busy).toBe(false);
  });

  it('ignores a second start while one is running', async () => {
    const { result, save } = setup();
    let release!: () => void;
    save.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          release = () => resolve(undefined);
        }),
    );

    let first!: Promise<void>;
    act(() => {
      first = result.current.backup();
    });
    expect(result.current.busy).toBe(true);
    await act(() => result.current.backup());
    expect(save).toHaveBeenCalledTimes(1);

    release();
    await act(() => first);
    expect(result.current.busy).toBe(false);
  });
});

describe('useBackup import', () => {
  it('imports the notes of a valid backup and says how many were imported and skipped', async () => {
    const { result, importNotes, onError } = setup();
    importNotes.mockResolvedValueOnce({ imported: 2, skipped: 1, replacedActive: false });
    const incoming = [note('a', '新內容', 2_000), note('b', 'B'), note('c', 'C')];

    await act(() => result.current.importFile(jsonFile(serializeBackup(createBackup(incoming, NOW)))));

    expect(importNotes).toHaveBeenCalledWith(incoming);
    expect(result.current.message).toBe('已匯入 2 篇，略過 1 篇（本機版本較新）');
    expect(onError).not.toHaveBeenCalled();
  });

  it('rejects a file that is not a backup without importing anything', async () => {
    const { result, importNotes, onError } = setup();

    await act(() => result.current.importFile(jsonFile('{"app":"other","version":1}')));

    expect(onError).toHaveBeenCalledWith(NOT_A_BACKUP_MESSAGE, expect.any(InvalidBackupError));
    expect(importNotes).not.toHaveBeenCalled();
    expect(result.current.message).toBeUndefined();
  });

  it('reports a failed import', async () => {
    const { result, importNotes, onError } = setup();
    const failure = new Error('disk full');
    importNotes.mockRejectedValueOnce(failure);

    await act(() => result.current.importFile(jsonFile(serializeBackup(createBackup([note('x', 'X')], NOW)))));

    expect(onError).toHaveBeenCalledWith(IMPORT_FAILED_MESSAGE, failure);
    expect(result.current.message).toBeUndefined();
  });
});
