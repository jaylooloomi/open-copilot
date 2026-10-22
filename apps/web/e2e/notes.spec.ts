import { expect, test, type Page } from '@playwright/test';

interface SavedNote {
  id: string;
  title: string;
  content: unknown;
  updatedAt: number;
}

/** Reads what the app has persisted in IndexedDB (database "open-copilot", store "notes"). */
function savedNotes(page: Page): Promise<SavedNote[]> {
  return page.evaluate(
    () =>
      new Promise<SavedNote[]>((resolve, reject) => {
        const open = indexedDB.open('open-copilot');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('notes', 'readonly').objectStore('notes').getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(request.result as SavedNote[]);
          };
        };
      }),
  );
}

/** Title + whether the body JSON contains `text`, newest first. */
async function savedSummary(page: Page, text: string) {
  const notes = await savedNotes(page);
  return notes
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((n) => ({ title: n.title, hasText: JSON.stringify(n.content).includes(text) }));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: '標題' })).toBeVisible();
});

test('新增筆記、輸入標題與內文，重新整理後內容仍在', async ({ page }) => {
  const list = page.getByRole('list', { name: '筆記清單' });
  const title = page.getByRole('textbox', { name: '標題' });
  const body = page.getByRole('textbox', { name: '筆記內文' });

  await page.getByRole('button', { name: '新增筆記' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);

  await title.fill('第一篇筆記');
  await body.click();
  await page.keyboard.type('這是內文');
  await expect(list.getByRole('button', { name: /^第一篇筆記/ })).toBeVisible();

  // Wait for the 500ms debounced save to reach IndexedDB before reloading.
  await expect
    .poll(() => savedSummary(page, '這是內文'))
    .toEqual([
      { title: '第一篇筆記', hasText: true },
      { title: '', hasText: false },
    ]);

  await page.reload();
  await expect(title).toHaveValue('第一篇筆記');
  await expect(body).toContainText('這是內文');
  await expect(list.getByRole('listitem')).toHaveCount(2);
});

test('輸入後立刻重新整理，最後的輸入也不會遺失', async ({ page }) => {
  // No waiting for the 500ms debounce: the pagehide flush must persist the edit.
  await page.getByRole('textbox', { name: '標題' }).fill('立刻重整');
  await page.reload();
  await expect(page.getByRole('textbox', { name: '標題' })).toHaveValue('立刻重整');
});

test('切換筆記與刪除筆記', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  const list = page.getByRole('list', { name: '筆記清單' });
  const title = page.getByRole('textbox', { name: '標題' });
  const body = page.getByRole('textbox', { name: '筆記內文' });

  await title.fill('筆記 A');
  await body.click();
  await page.keyboard.type('內容 A');

  await page.getByRole('button', { name: '新增筆記' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(title).toHaveValue('');
  await title.fill('筆記 B');
  await body.click();
  await page.keyboard.type('內容 B');

  await list.getByRole('button', { name: /^筆記 A/ }).click();
  await expect(title).toHaveValue('筆記 A');
  await expect(body).toContainText('內容 A');

  await list.getByRole('button', { name: /^筆記 B/ }).click();
  await expect(title).toHaveValue('筆記 B');
  await expect(body).toContainText('內容 B');

  await list.getByRole('button', { name: '刪除「筆記 A」' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).not.toContainText('筆記 A');

  await expect.poll(() => savedSummary(page, '內容 B')).toEqual([{ title: '筆記 B', hasText: true }]);
  await page.reload();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(title).toHaveValue('筆記 B');
});

test('窄螢幕時筆記清單收成抽屜', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const list = page.getByRole('list', { name: '筆記清單' });

  await expect(list).toBeHidden();

  // The palette popover must stay inside the viewport; 灰色 is its right-most swatch.
  await page.getByRole('button', { name: '螢光筆', exact: true }).click();
  const box = await page.getByRole('group', { name: '螢光筆色盤' }).boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: '灰色' }).click();
  await expect(page.getByRole('group', { name: '螢光筆色盤' })).toBeHidden();

  await page.getByRole('button', { name: '開啟筆記清單' }).click();
  await expect(list).toBeVisible();

  await page.getByRole('button', { name: '新增筆記' }).click();
  await expect(list).toBeHidden();

  await page.getByRole('button', { name: '開啟筆記清單' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
});
