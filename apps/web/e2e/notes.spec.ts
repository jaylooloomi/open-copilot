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

test('在標題按 Enter 後立刻打字，字會進內文而不是標題', async ({ page }) => {
  const title = page.getByRole('textbox', { name: '標題' });
  const body = page.getByRole('textbox', { name: '筆記內文' });
  await title.fill('標題A');
  // No pause between Enter and typing: focus must already be in the body when the next key arrives.
  await title.press('Enter');
  await page.keyboard.type('X1');
  await expect(title).toHaveValue('標題A');
  await expect(body).toContainText('X1');
  await expect(body).toBeFocused();
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

test('滑鼠仍停在剛開啟的格式按鈕上時，按鈕維持填色、圖示看得見', async ({ page }) => {
  await page.getByRole('textbox', { name: '筆記內文' }).click();
  const bold = page.getByRole('button', { name: '粗體' });
  await bold.click();
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await bold.hover();
  const { background, color } = await bold.evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, color: style.color };
  });
  expect(color).toBe('rgb(255, 255, 255)');
  // Not the pale hover background (#fdf4ff) and not white: the white icon must stay visible.
  expect(background).not.toBe('rgb(253, 244, 255)');
  expect(background).not.toBe('rgb(255, 255, 255)');
  expect(background).not.toBe('rgba(0, 0, 0, 0)');
});

test('新增筆記後游標停在新筆記的標題', async ({ page }) => {
  await page.getByRole('button', { name: '新增筆記' }).click();
  await expect(page.getByRole('list', { name: '筆記清單' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: '標題' })).toBeFocused();
  await page.keyboard.type('直接輸入');
  await expect(page.getByRole('textbox', { name: '標題' })).toHaveValue('直接輸入');
});

test('窄螢幕時錄製與 AI 按鈕排在同一列，頁面不會橫向捲動', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Located by class: its label is 請先設定 until a backend is configured (M3b).
  const record = await page.locator('.oc-record-btn').boundingBox();
  const summary = await page.getByRole('button', { name: 'AI 摘要' }).boundingBox();
  expect(Math.abs(record!.y + record!.height / 2 - (summary!.y + summary!.height / 2))).toBeLessThan(
    4,
  );
  // The settings gear stays on the same row and inside the screen.
  const gear = await page.getByRole('button', { name: '設定', exact: true }).boundingBox();
  expect(Math.abs(record!.y + record!.height / 2 - (gear!.y + gear!.height / 2))).toBeLessThan(4);
  expect(gear!.x + gear!.width).toBeLessThanOrEqual(390);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});

test('置中的清單項目，項目符號跟著文字一起置中', async ({ page }) => {
  const body = page.getByRole('textbox', { name: '筆記內文' });
  await body.click();
  await page.getByRole('button', { name: '項目清單' }).click();
  await page.keyboard.type('置中項目');
  await page.getByRole('button', { name: '置中' }).click();

  const li = body.locator('li').first();
  await expect(li.locator('p')).toHaveAttribute('style', /text-align: center/);
  const layout = await li.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el.querySelector('p')!);
    const text = range.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return {
      position: getComputedStyle(el).listStylePosition,
      textLeft: text.left,
      textTop: text.top,
      liLeft: box.left,
      liTop: box.top,
      liRight: box.right,
    };
  });
  // The marker sits inside the item, just before the text, instead of at the far left edge.
  expect(layout.position).toBe('inside');
  // Marker and text share the first line (the paragraph is not pushed below the marker).
  expect(layout.textTop - layout.liTop).toBeLessThan(4);
  // The text itself is centred in the item.
  const middle = (layout.liLeft + layout.liRight) / 2;
  expect(layout.textLeft).toBeGreaterThan(middle - 120);
});

test('窄螢幕時 AI 按鈕列右緣淡出，提示可以橫向捲動', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const group = page.locator('.oc-ai-group');
  const overflowing = await group.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(overflowing).toBe(true);
  const mask = await group.evaluate((el) => {
    const style = getComputedStyle(el);
    return style.maskImage || style.webkitMaskImage;
  });
  expect(mask).toContain('linear-gradient');

  // Scrolled to the end, the last chip is fully visible, clear of the faded edge.
  await group.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  const groupBox = (await group.boundingBox())!;
  const last = (await group.locator('.oc-ai-btn').last().boundingBox())!;
  expect(last.x + last.width).toBeLessThanOrEqual(groupBox.x + groupBox.width - 12);
});
