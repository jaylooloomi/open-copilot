import type { JSONContent, Note } from '@oc/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackup, serializeBackup } from './backup/backupFormat';
import { LAST_BACKUP_KEY } from './backup/backupReminder';
import { NotesApp } from './NotesApp';
import { PlatformProvider } from './platform/PlatformContext';
import { readBlobText } from './test/blob';
import { createTestPlatform } from './test/memoryStorage';

const doc = (text: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const note = (id: string, title: string, text: string, updatedAt: number): Note => ({
  id,
  title,
  content: doc(text),
  createdAt: updatedAt,
  updatedAt,
});

async function renderApp(initial: Note[]) {
  const ctx = createTestPlatform(initial);
  render(
    <PlatformProvider platform={ctx.platform}>
      <NotesApp />
    </PlatformProvider>,
  );
  await screen.findByRole('textbox', { name: '標題' });
  ctx.storage.put.mockClear();
  return { ...ctx, user: userEvent.setup() };
}

const backupFile = (notes: Note[]) =>
  new File([serializeBackup(createBackup(notes, 5_000))], 'backup.json', { type: 'application/json' });
const chooseFile = (file: File) =>
  fireEvent.change(screen.getByLabelText('選擇備份檔'), { target: { files: [file] } });
const list = () => screen.getByRole('list', { name: '筆記清單' });
const body = () => screen.getByRole('textbox', { name: '筆記內文' });

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('NotesApp backup', () => {
  it('reminds to back up, backs up from the banner and then shows the tip again', async () => {
    const saved = note('a', '週會', '內容', 1_000);
    const { user, fileSaver } = await renderApp([saved]);
    expect(screen.getByRole('note')).toHaveTextContent('已超過 7 天沒有備份筆記');

    await user.click(screen.getByRole('button', { name: '立即備份' }));

    await waitFor(() => expect(screen.getByRole('note')).toHaveTextContent('手動輸入累了？'));
    expect(fileSaver.save).toHaveBeenCalledTimes(1);
    const [filename, data] = fileSaver.save.mock.calls[0]!;
    expect(filename).toMatch(/^open-copilot-backup-\d{8}-\d{4}\.json$/);
    expect(JSON.parse(await readBlobText(data)).notes).toEqual([saved]);
    expect(Number(localStorage.getItem(LAST_BACKUP_KEY))).toBeGreaterThan(0);
    expect(screen.getByText('已備份 1 篇筆記')).toBeInTheDocument();
  });

  it('backs up from the 備份 button below the note list', async () => {
    const { user, fileSaver } = await renderApp([note('a', '週會', '內容', 1_000)]);
    await user.click(within(screen.getByRole('navigation', { name: '筆記' })).getByRole('button', { name: '備份' }));
    await waitFor(() => expect(fileSaver.save).toHaveBeenCalledTimes(1));
  });

  it('imports a backup and shows the newer imported version of the open note', async () => {
    await renderApp([note('a', '週會', '舊內容', 1_000)]);

    chooseFile(backupFile([note('a', '週會', '新內容', 2_000), note('b', '專案', '專案內容', 500)]));

    expect(await screen.findByText('已匯入 2 篇，略過 0 篇（本機版本較新）')).toBeInTheDocument();
    await waitFor(() => expect(body()).toHaveTextContent('新內容'));
    expect(within(list()).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list()).getByRole('button', { name: /^專案/ })).toBeInTheDocument();
  });

  it('keeps a note that is newer here and says it was skipped', async () => {
    const { storage } = await renderApp([note('a', '週會', '本機內容', 3_000)]);

    chooseFile(backupFile([note('a', '週會', '舊備份', 2_000)]));

    expect(await screen.findByText('已匯入 0 篇，略過 1 篇（本機版本較新）')).toBeInTheDocument();
    expect(body()).toHaveTextContent('本機內容');
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('rejects a file that is not an open-copilot backup without writing anything', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { storage } = await renderApp([note('a', '週會', '內容', 1_000)]);

    chooseFile(new File(['{"app":"other","version":1}'], 'other.json', { type: 'application/json' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('這不是 open-copilot 的備份檔');
    expect(storage.put).not.toHaveBeenCalled();
    expect(within(list()).getAllByRole('listitem')).toHaveLength(1);
    expect(error).toHaveBeenCalledWith('Backup or import failed', expect.any(Error));
  });

  it('locks the note list while an import is still writing', async () => {
    const { storage } = await renderApp([note('a', '週會', '內容', 1_000)]);
    let release!: () => void;
    storage.put.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    chooseFile(backupFile([note('b', '專案', '專案內容', 500)]));

    await waitFor(() => expect(storage.put).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: '刪除「週會」' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^週會/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '新增筆記' })).toBeDisabled();

    release();

    expect(await screen.findByText('已匯入 1 篇，略過 0 篇（本機版本較新）')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刪除「週會」' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '新增筆記' })).toBeEnabled();
  });
});
