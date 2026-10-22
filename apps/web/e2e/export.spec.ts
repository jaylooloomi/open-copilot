import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/** Fills in a note with a title and two body paragraphs, the second one bold. */
async function writeNote(page: Page) {
  await page.getByRole('textbox', { name: '標題' }).fill('週會紀錄');
  await page.getByRole('textbox', { name: '筆記內文' }).click();
  await page.keyboard.type('第一點');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+B');
  await page.keyboard.type('重要');
}

async function exportAs(page: Page, label: string) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出' }).click();
  await page.getByRole('menuitem', { name: label }).click();
  return download;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: '標題' })).toBeVisible();
  await writeNote(page);
});

test('匯出 Markdown 下載 <標題>.md', async ({ page }) => {
  const download = await exportAs(page, 'Markdown');
  expect(download.suggestedFilename()).toBe('週會紀錄.md');
  expect(await readFile(await download.path(), 'utf8')).toBe('# 週會紀錄\n\n第一點\n\n**重要**\n');
  await expect(page.getByRole('status')).toHaveText('已匯出 Markdown');
});

test('匯出純文字與 Word', async ({ page }) => {
  const txt = await exportAs(page, '純文字');
  expect(txt.suggestedFilename()).toBe('週會紀錄.txt');
  expect(await readFile(await txt.path(), 'utf8')).toBe('週會紀錄\n\n第一點\n重要');

  const docx = await exportAs(page, 'Word');
  expect(docx.suggestedFilename()).toBe('週會紀錄.docx');
  const bytes = await readFile(await docx.path());
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK'); // a .docx is a zip file
  await expect(page.getByRole('status')).toHaveText('已匯出 Word');
});

/** What the stubbed print() saw: the frame's title and body, and the tab title. */
type Printed = { title: string; tabTitle: string; body: string };

test('匯出 PDF 把筆記交給隱藏 iframe 列印', async ({ page }) => {
  await expect(page).toHaveTitle('open-copilot');
  // Replace print() on the print iframe so no dialog opens; record what it would print.
  // This hooks document.body.appendChild, which is how printPdf adds its iframe; if printPdf
  // switches to append() or insertBefore(), move the hook too.
  await page.evaluate(() => {
    const w = window as unknown as { printed?: Printed };
    const append = document.body.appendChild.bind(document.body);
    document.body.appendChild = <T extends Node>(node: T): T => {
      const result = append(node);
      if (node instanceof HTMLIFrameElement) {
        node.contentWindow!.print = () => {
          w.printed = {
            title: node.contentDocument!.title,
            // Chrome names the saved PDF after the tab title, so it must be the note title here.
            tabTitle: document.title,
            body: node.contentDocument!.body.innerHTML,
          };
        };
      }
      return result;
    };
  });

  await page.getByRole('button', { name: '匯出' }).click();
  await page.getByRole('menuitem', { name: 'PDF' }).click();

  const printed = () => page.evaluate(() => (window as unknown as { printed?: Printed }).printed);
  await expect.poll(async () => (await printed())?.title).toBe('週會紀錄');
  expect((await printed())?.tabTitle).toBe('週會紀錄');
  expect((await printed())?.body).toBe('<h1>週會紀錄</h1><p>第一點</p><p><strong>重要</strong></p>');

  // The stub never fires afterprint; fire it the way the browser does when the dialog closes.
  await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('iframe[data-oc-print]')!;
    frame.contentWindow!.dispatchEvent(new Event('afterprint'));
  });
  await expect(page).toHaveTitle('open-copilot');
  await expect(page.locator('iframe[data-oc-print]')).toHaveCount(0);
});

test('複製全文寫入剪貼簿', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: '複製' }).click();

  await expect(page.getByRole('status')).toHaveText('已複製全文');
  const copied = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    return {
      types: item.types,
      html: await (await item.getType('text/html')).text(),
      // The Windows clipboard stores line breaks as CRLF.
      text: (await navigator.clipboard.readText()).replaceAll('\r\n', '\n'),
    };
  });
  expect(copied.types).toEqual(expect.arrayContaining(['text/html', 'text/plain']));
  expect(copied.html).toContain('<h1>週會紀錄</h1>');
  expect(copied.html).toContain('<strong>重要</strong>');
  expect(copied.text).toBe('週會紀錄\n\n第一點\n重要');
});

test('窄螢幕時匯出選單完整顯示在畫面內', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '匯出' }).click();

  const menu = page.getByRole('menu', { name: '匯出格式' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Markdown', 'Word', '純文字', 'PDF']);
  const box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});
