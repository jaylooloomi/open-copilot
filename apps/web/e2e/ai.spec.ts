import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/**
 * The mocked backend lives under the dev server's own origin, so no CORS is involved; every
 * request to it is answered by page.route below and never reaches Vite.
 */
const API = 'http://localhost:5173/mock-api';
const PRIVACY_KEY = 'oc.aiPrivacyAcknowledged';

async function configure(page: Page, { acknowledged }: { acknowledged: boolean }) {
  await page.addInitScript(
    ({ api, acknowledged: ack, key }) => {
      localStorage.setItem('oc.settings', JSON.stringify({ apiBaseUrl: api, accessKey: 'dev-key' }));
      if (ack) localStorage.setItem(key, '1');
    },
    { api: API, acknowledged, key: PRIVACY_KEY },
  );
}

async function writeNote(page: Page, title: string, text: string) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '標題' }).fill(title);
  await page.getByRole('textbox', { name: '筆記內文' }).click();
  await page.keyboard.type(text);
}

/** How many rows the formatting toolbar's groups take. */
async function toolbarRows(page: Page): Promise<number> {
  return page.locator('.oc-toolbar').evaluate(
    (toolbar) => new Set([...toolbar.children].map((child) => Math.round(child.getBoundingClientRect().top))).size,
  );
}

/** Per task item: the checkbox's vertical centre minus that of the first line of the item's text. */
async function checkboxOffsets(page: Page): Promise<number[]> {
  return page.locator('ul[data-type="taskList"] > li').evaluateAll((items) =>
    items.map((li) => {
      const box = li.querySelector('input')!.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(li.querySelector(':scope > div > p')!);
      const line = range.getClientRects()[0]!;
      return (box.top + box.bottom) / 2 - (line.top + line.bottom) / 2;
    }),
  );
}

test('AI 摘要：第一次先顯示隱私說明，摘要插入到筆記開頭', async ({ page }) => {
  await configure(page, { acknowledged: false });
  const requests: { body: unknown; authorization?: string }[] = [];
  await page.route(`${API}/ai/summary`, async (route) => {
    requests.push({
      body: route.request().postDataJSON(),
      authorization: route.request().headers()['authorization'],
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ summary: '決定下週三前寄出報價單。' }),
    });
  });

  await writeNote(page, '週會', '下週三前要寄出報價單。');
  await page.getByRole('button', { name: 'AI 摘要' }).click();

  const notice = page.getByRole('dialog', { name: 'AI 功能說明' });
  await expect(notice).toContainText('筆記內容會送到 Groq 處理');
  await expect(notice.getByRole('button', { name: '我知道了' })).toBeVisible();
  // Still nothing sent while the notice is open.
  expect(requests).toHaveLength(0);
  await notice.getByRole('button', { name: '我知道了' }).click();
  await expect(notice).toBeHidden();
  expect(await page.evaluate((key) => localStorage.getItem(key), PRIVACY_KEY)).toBe('1');

  const panel = page.getByRole('complementary', { name: 'AI 摘要' });
  await expect(panel).toContainText('決定下週三前寄出報價單。');
  expect(requests).toEqual([
    { body: { title: '週會', text: '下週三前要寄出報價單。' }, authorization: 'Bearer dev-key' },
  ]);

  await panel.getByRole('button', { name: '插入到筆記開頭' }).click();
  await expect(panel).toBeHidden();
  const paragraphs = page.getByRole('textbox', { name: '筆記內文' }).locator('p');
  await expect(paragraphs.nth(0)).toHaveText('決定下週三前寄出報價單。');
  await expect(paragraphs.nth(1)).toHaveText('下週三前要寄出報價單。');

  // The notice is shown only once.
  await page.getByRole('button', { name: 'AI 摘要' }).click();
  await expect(page.getByRole('complementary', { name: 'AI 摘要' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'AI 功能說明' })).toHaveCount(0);
  await expect.poll(() => requests.length).toBe(2);
});

test('待辦事項：勾選清單插入筆記結尾，匯出 Markdown 為 - [ ] 與 - [x]', async ({ page }) => {
  await configure(page, { acknowledged: true });
  await page.route(`${API}/ai/todos`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: ['寄出報價單', '預約會議室'] }),
    }),
  );

  await writeNote(page, '週會', '會議紀錄');
  await page.getByRole('button', { name: '待辦事項' }).click();

  const panel = page.getByRole('complementary', { name: '待辦事項' });
  await expect(panel.getByRole('checkbox', { name: '預約會議室' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Opening the side panel narrows the note, but the toolbar keeps to one row so the note does not jump.
  expect(await toolbarRows(page)).toBe(1);
  await panel.getByRole('checkbox', { name: '預約會議室' }).check();
  await panel.getByRole('button', { name: '插入到筆記結尾' }).click();
  await expect(panel).toBeHidden();

  const body = page.getByRole('textbox', { name: '筆記內文' });
  await expect(body.locator('h2')).toHaveText('待辦事項');
  const items = body.locator('ul[data-type="taskList"] > li');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).locator('input[type="checkbox"]')).not.toBeChecked();
  await expect(items.nth(1).locator('input[type="checkbox"]')).toBeChecked();
  // Each checkbox sits level with the first line of its text.
  for (const offset of await checkboxOffsets(page)) expect(Math.abs(offset)).toBeLessThanOrEqual(4);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出' }).click();
  await page.getByRole('menuitem', { name: 'Markdown' }).click();
  const file = await download;
  expect(await readFile(await file.path(), 'utf8')).toBe(
    '# 週會\n\n會議紀錄\n\n### 待辦事項\n\n- [ ] 寄出報價單\n- [x] 預約會議室\n',
  );
});

test('AI 按鈕在筆記內容為空時停用並說明原因', async ({ page }) => {
  await configure(page, { acknowledged: true });
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: '標題' })).toBeVisible();
  for (const name of ['AI 摘要', '待辦事項']) {
    const button = page.getByRole('button', { name });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('title', '筆記內容是空的');
  }
  for (const name of ['AI 助理', 'AI 對話']) {
    await expect(page.getByRole('button', { name })).toHaveAttribute('title', '即將推出');
  }
});

test('後端未啟用 AI 時在面板說明原因，可重試', async ({ page }) => {
  await configure(page, { acknowledged: true });
  let calls = 0;
  await page.route(`${API}/ai/summary`, (route) => {
    calls += 1;
    return calls === 1
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"ai_unavailable"}' })
      : route.fulfill({ status: 200, contentType: 'application/json', body: '{"summary":"好了"}' });
  });

  await writeNote(page, '', '內容');
  await page.getByRole('button', { name: 'AI 摘要' }).click();
  const panel = page.getByRole('complementary', { name: 'AI 摘要' });
  await expect(panel.getByRole('alert')).toHaveText('後端尚未啟用 AI 功能（缺少 Groq 金鑰）');
  await panel.getByRole('button', { name: '重試' }).click();
  await expect(panel).toContainText('好了');
});
