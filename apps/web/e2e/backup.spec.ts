import { readFile } from 'node:fs/promises';
import { devices, expect, test, type FileChooser, type Page } from '@playwright/test';

interface StoredNote {
  id: string;
  title: string;
  content: unknown;
  createdAt: number;
  updatedAt: number;
}

/**
 * Reads what the app has persisted in IndexedDB (database "open-copilot", store "notes").
 * Resolves to [] when the app has not created the database yet, and never creates it itself:
 * an empty v1 database would make the app skip its upgrade and miss its stores.
 */
function savedNotes(page: Page): Promise<StoredNote[]> {
  return page.evaluate(
    () =>
      new Promise<StoredNote[]>((resolve, reject) => {
        let missing = false;
        const open = indexedDB.open('open-copilot');
        open.onupgradeneeded = () => {
          missing = true;
          open.transaction?.abort();
        };
        open.onerror = () => (missing ? resolve([]) : reject(open.error));
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('notes')) {
            db.close();
            resolve([]);
            return;
          }
          try {
            const request = db.transaction('notes', 'readonly').objectStore('notes').getAll();
            request.onerror = () => {
              db.close();
              reject(request.error);
            };
            request.onsuccess = () => {
              db.close();
              resolve(request.result as StoredNote[]);
            };
          } catch (error) {
            db.close();
            reject(error);
          }
        };
      }),
  );
}

/** Opens the file picker from 匯入 and chooses `files`. */
async function importFrom(page: Page, files: Parameters<FileChooser['setFiles']>[0]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '匯入', exact: true }).click();
  await (await chooser).setFiles(files);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: '標題' })).toBeVisible();
});

test('備份 → 清空資料 → 匯入，筆記內容一致', async ({ page, browser }) => {
  // A fresh start only has the empty first note: the usual tip, not the reminder.
  await expect(page.getByRole('note')).toContainText('手動輸入累了？');

  await page.getByRole('textbox', { name: '標題' }).fill('週會紀錄');
  await page.getByRole('textbox', { name: '筆記內文' }).click();
  await page.keyboard.type('第一點');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+B');
  await page.keyboard.type('重要');

  // Never backed up, and there is a note: the banner reminds.
  await expect(page.getByRole('note')).toContainText('已超過 7 天沒有備份筆記');
  // Wait for the debounced autosave, so the stored note is what the backup holds.
  await expect.poll(async () => JSON.stringify(await savedNotes(page))).toContain('重要');
  const before = await savedNotes(page);
  expect(before).toHaveLength(1);

  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '備份', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/^open-copilot-backup-\d{8}-\d{4}\.json$/);
  const backupPath = await download.path();
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  expect(backup).toMatchObject({ app: 'open-copilot', version: 1, exportedAt: expect.any(Number) });
  expect(backup.notes).toEqual(before);

  // The backup is recorded and the usual banner is back.
  await expect(page.getByText('已備份 1 篇筆記')).toBeVisible();
  await expect(page.getByRole('note')).toContainText('手動輸入累了？');
  expect(await page.evaluate(() => localStorage.getItem('oc.lastBackupAt'))).toMatch(/^\d+$/);

  // 清空資料: a new browser context starts with empty IndexedDB and localStorage.
  // Same device settings and base URL as the project's own context.
  const fresh = await browser.newContext({
    ...devices['Desktop Chrome'],
    baseURL: new URL('/', page.url()).href,
  });
  try {
    const restored = await fresh.newPage();
    await restored.goto('/');
    await expect(restored.getByRole('textbox', { name: '標題' })).toBeVisible();
    const list = restored.getByRole('list', { name: '筆記清單' });
    await expect(list.getByRole('listitem')).toHaveCount(1);
    expect(await savedNotes(restored)).toHaveLength(1);

    await importFrom(restored, backupPath);

    await expect(restored.getByText('已匯入 1 篇，略過 0 篇（本機版本較新）')).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect
      .poll(async () => (await savedNotes(restored)).find((n) => n.id === before[0]!.id))
      .toEqual(before[0]);

    // The same file again: the local copy is as new, so nothing is imported.
    await importFrom(restored, backupPath);
    await expect(restored.getByText('已匯入 0 篇，略過 1 篇（本機版本較新）')).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(2);

    await list.getByRole('button', { name: /^週會紀錄/ }).click();
    await expect(restored.getByRole('textbox', { name: '標題' })).toHaveValue('週會紀錄');
    const body = restored.getByRole('textbox', { name: '筆記內文' });
    await expect(body).toContainText('第一點');
    await expect(body.locator('strong')).toHaveText('重要');
  } finally {
    await fresh.close();
  }
});

test('不是備份檔時顯示錯誤，不寫入任何資料', async ({ page }) => {
  const before = await savedNotes(page);

  await importFrom(page, {
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'other', version: 1, notes: [] })),
  });

  await expect(page.getByRole('alert')).toContainText('這不是 open-copilot 的備份檔');
  await expect(page.getByRole('list', { name: '筆記清單' }).getByRole('listitem')).toHaveCount(1);
  expect(await savedNotes(page)).toEqual(before);
});

test('讀取已存筆記的輔助函式不會自行建立資料庫', async ({ browser, baseURL }) => {
  const blank = await browser.newContext({ ...devices['Desktop Chrome'] });
  try {
    const other = await blank.newPage();
    // Same origin, but the app never runs, so its database does not exist yet.
    await other.route('**/*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>blank</title>',
      }),
    );
    await other.goto(baseURL ?? 'http://localhost:5173');
    expect(await savedNotes(other)).toEqual([]);
    expect(
      await other.evaluate(async () => (await indexedDB.databases()).map((d) => d.name)),
    ).not.toContain('open-copilot');
  } finally {
    await blank.close();
  }
});
