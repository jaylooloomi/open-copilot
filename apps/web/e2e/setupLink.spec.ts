import { expect, test } from '@playwright/test';

/** Same origin as the dev server; page.route answers it, so nothing reaches a real backend. */
const API = 'http://localhost:5173/mock-api';

/** What scripts/prototype.mjs puts after #oc-setup=. */
const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

test('#oc-setup 連結會填好設定，並立刻從網址列移除', async ({ page }) => {
  await page.route(`${API}/health`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
  );

  await page.goto(`/#oc-setup=${encode({ apiBaseUrl: API, accessKey: 'prototype-key-0123' })}`);

  const record = page.locator('.oc-record-btn');
  await expect(record).toHaveText('錄製');
  expect(new URL(page.url()).hash).toBe('');
  expect(await page.evaluate(() => localStorage.getItem('oc.settings'))).toBe(
    JSON.stringify({ apiBaseUrl: API, accessKey: 'prototype-key-0123' }),
  );

  // The saved settings stay after a reload without the link.
  await page.reload();
  await expect(record).toHaveText('錄製');
});

test('格式不對的 #oc-setup 會被忽略，不會報錯', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/#oc-setup=not-a-valid-payload');

  await expect(page.locator('.oc-record-btn')).toHaveText('請先設定');
  expect(new URL(page.url()).hash).toBe('');
  expect(errors).toEqual([]);
});

test('指向其他網站的 #oc-setup 不會覆蓋現有設定', async ({ page }) => {
  await page.route(`${API}/health`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
  );
  await page.goto(`/#oc-setup=${encode({ apiBaseUrl: API, accessKey: 'prototype-key-0123' })}`);
  await expect(page.locator('.oc-record-btn')).toHaveText('錄製');

  await page.goto(
    `/#oc-setup=${encode({ apiBaseUrl: 'https://attacker.example/api', accessKey: 'attacker-key-0123' })}`,
  );
  await page.reload();

  await expect(page.locator('.oc-record-btn')).toHaveText('錄製');
  expect(new URL(page.url()).hash).toBe('');
  expect(await page.evaluate(() => localStorage.getItem('oc.settings'))).toBe(
    JSON.stringify({ apiBaseUrl: API, accessKey: 'prototype-key-0123' }),
  );
});

test('按過「測試連線」後，Esc 仍能關閉設定視窗', async ({ page }) => {
  let answer: () => void = () => {};
  await page.route(`${API}/health`, async (route) => {
    // Hold the answer so the button stays disabled (and loses focus) for a moment, like a real test.
    await new Promise<void>((resolve) => (answer = resolve));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.goto(`/#oc-setup=${encode({ apiBaseUrl: API, accessKey: 'prototype-key-0123' })}`);

  await page.getByRole('button', { name: '設定', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '設定' });
  const testButton = dialog.getByRole('button', { name: '測試連線' });
  await testButton.click();
  await expect(testButton).toBeDisabled();
  answer();
  await expect(dialog.getByText('連線成功')).toBeVisible();
  await expect(testButton).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('連結要換掉另一把已存的金鑰時會先詢問，按取消就保留原設定', async ({ page }) => {
  await page.route(`${API}/health`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
  );
  await page.goto(`/#oc-setup=${encode({ apiBaseUrl: API, accessKey: 'prototype-key-0123' })}`);
  await expect(page.locator('.oc-record-btn')).toHaveText('錄製');

  const questions: string[] = [];
  page.once('dialog', (dialog) => {
    questions.push(`${dialog.type()}:${dialog.message()}`);
    void dialog.dismiss();
  });
  await page.goto(`/#oc-setup=${encode({ apiBaseUrl: API, accessKey: 'other-key-0123' })}`);
  await page.reload();

  await expect(page.locator('.oc-record-btn')).toHaveText('錄製');
  expect(questions).toHaveLength(1);
  expect(questions[0]).toMatch(/^confirm:.*取代/);
  expect(questions[0]).not.toContain('key-0123');
  expect(await page.evaluate(() => localStorage.getItem('oc.settings'))).toBe(
    JSON.stringify({ apiBaseUrl: API, accessKey: 'prototype-key-0123' }),
  );
});
