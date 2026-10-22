import { devices, expect, test } from '@playwright/test';

// A typical Android phone: 412 CSS px wide, touch input, Android Chrome user agent.
// defaultBrowserType is left out: it would force a new worker, and this project is Chromium anyway.
const { defaultBrowserType: _browserType, ...pixel7 } = devices['Pixel 7'];
test.use(pixel7);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: '標題' })).toBeVisible();
});

test('手機尺寸：點選單鈕打開筆記清單抽屜，點背景關閉', async ({ page }) => {
  const list = page.getByRole('list', { name: '筆記清單' });
  await expect(list).toBeHidden();

  await page.getByRole('button', { name: '開啟筆記清單' }).tap();
  await expect(list).toBeVisible();

  // The drawer is at most 300px wide; the backdrop covers the rest of the screen.
  await page.locator('.oc-backdrop').tap({ position: { x: 380, y: 450 } });
  await expect(list).toBeHidden();
  await expect(page.getByRole('button', { name: '開啟筆記清單' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('手機尺寸：畫面不會左右捲動，錄製、設定、匯出都在畫面內', async ({ page }) => {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

  for (const control of [
    page.locator('.oc-record-btn'),
    page.getByRole('button', { name: '設定', exact: true }),
    page.getByRole('button', { name: '匯出', exact: true }),
  ]) {
    await expect(control).toBeVisible();
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
});
