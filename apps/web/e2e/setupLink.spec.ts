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
