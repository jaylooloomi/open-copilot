import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * The mocked backend lives under the dev server's own origin, so no CORS is involved; every
 * request to it is answered by page.route below and never reaches Vite.
 */
const API = 'http://localhost:5173/mock-api';

/** `seq` from the multipart body the app posts to /transcribe. */
function seqOf(route: Route): number {
  const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
  const match = /name="seq"\r\n\r\n(\d+)/.exec(body);
  if (!match) throw new Error('no seq field in the /transcribe request');
  return Number(match[1]);
}

const transcript = (route: Route, seq: number) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ seq, text: `第${seq}段。` }) });

/** Rows in the app's IndexedDB store `pendingSegments` (audio waiting for a retry). */
function pendingCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('open-copilot');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('pendingSegments', 'readonly').objectStore('pendingSegments').count();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
        };
      }),
  );
}

/** Whether the saved note body (IndexedDB store `notes`) already contains a transcript gap. */
function savedNoteHasGap(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open('open-copilot');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('notes', 'readonly').objectStore('notes').getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(JSON.stringify(request.result).includes('"transcriptGap"'));
          };
        };
      }),
  );
}

test('設定後端後錄音，轉寫結果依錄音順序插入游標位置', async ({ page }) => {
  test.setTimeout(60_000);
  const seen: number[] = [];
  const authorization: (string | undefined)[] = [];
  let secondArrived: () => void = () => undefined;
  const second = new Promise<void>((resolve) => (secondArrived = resolve));

  await page.route(`${API}/health`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
  );
  await page.route(`${API}/transcribe`, async (route) => {
    const seq = seqOf(route);
    seen.push(seq);
    authorization.push(route.request().headers()['authorization']);
    if (seq === 2) secondArrived();
    // Answer segment 1 only after segment 2 was sent: the app must still insert 1 before 2.
    // Bounded, so a missing segment 2 fails on the body text below instead of hanging.
    if (seq === 1) await Promise.race([second, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    await transcript(route, seq);
  });

  await page.goto('/');
  const record = page.locator('.oc-record-btn');
  await expect(record).toHaveText('請先設定');

  await record.click();
  const dialog = page.getByRole('dialog', { name: '設定' });
  await dialog.getByLabel('後端網址').fill(API);
  await dialog.getByLabel('存取金鑰').fill('dev-key');
  await dialog.getByRole('button', { name: '測試連線' }).click();
  await expect(dialog.getByText('連線成功')).toBeVisible();
  await dialog.getByRole('button', { name: '儲存' }).click();
  await expect(dialog).toBeHidden();
  await expect(record).toHaveText('錄製');

  const body = page.getByRole('textbox', { name: '筆記內文' });
  await body.click();
  await page.keyboard.type('開頭');

  await record.click();
  await expect(record).toHaveText('停止');
  await expect(page.getByRole('button', { name: '新增筆記' })).toBeDisabled();

  // The first cut comes after 4–8 seconds; stopping then sends the rest as segment 2.
  await expect.poll(() => seen.length, { timeout: 15_000 }).toBeGreaterThan(0);
  // Give the tail segment real encoded audio first: a MediaRecorder stopped within ~100 ms of
  // starting can yield an empty Blob, which SegmentRecorder drops (no segment 2). Cuts are at
  // least 4 s apart, so no second cut happens in this wait.
  await page.waitForTimeout(1_500);
  await record.click();

  await expect(record).toHaveText('錄製', { timeout: 15_000 });
  await expect(body).toHaveText('開頭第1段。第2段。');
  expect(seen.sort()).toEqual([1, 2]);
  expect(authorization).toEqual(['Bearer dev-key', 'Bearer dev-key']);
  await expect(page.getByRole('button', { name: '新增筆記' })).toBeEnabled();
});

test('一段連續失敗 4 次變成未轉寫標記，重新整理後點擊標記可補上', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript((api) => {
    localStorage.setItem('oc.settings', JSON.stringify({ apiBaseUrl: api, accessKey: 'dev-key' }));
  }, API);
  let failSegmentOne = true;
  let segmentOneAttempts = 0;
  await page.route(`${API}/transcribe`, async (route) => {
    const seq = seqOf(route);
    if (seq === 1 && failSegmentOne) {
      segmentOneAttempts += 1;
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"upstream_error"}' });
      return;
    }
    await transcript(route, seq);
  });

  await page.goto('/');
  const record = page.locator('.oc-record-btn');
  const body = page.getByRole('textbox', { name: '筆記內文' });
  await expect(record).toHaveText('錄製');
  await expect(record).toBeEnabled();
  await body.click();

  await record.click();
  await expect(record).toHaveText('停止');
  await expect.poll(() => segmentOneAttempts, { timeout: 15_000 }).toBeGreaterThan(0);
  // Same as above: the tail segment (segment 2) needs real encoded audio before stopping.
  await page.waitForTimeout(1_500);
  await record.click();

  // 1 try + 3 retries after 1s, 2s and 4s.
  const gap = page.locator('[data-transcript-gap]');
  await expect(gap).toHaveText('⚠ 第 1 段未轉寫・重試', { timeout: 20_000 });
  expect(segmentOneAttempts).toBe(4);
  await expect(body).toHaveText('⚠ 第 1 段未轉寫・重試第2段。');
  await expect(record).toHaveText('錄製');
  expect(await pendingCount(page)).toBe(1);

  // After a reload the audio comes from IndexedDB, not from memory.
  await expect.poll(() => savedNoteHasGap(page)).toBe(true);
  await page.reload();
  await expect(gap).toHaveText('⚠ 第 1 段未轉寫・重試');

  failSegmentOne = false;
  await gap.click();

  await expect(body).toHaveText('第1段。第2段。');
  await expect(gap).toHaveCount(0);
  // The audio stays until no saved note has the marker: once the transcript is saved, the next
  // load drops it.
  expect(await pendingCount(page)).toBe(1);
  await expect.poll(() => savedNoteHasGap(page)).toBe(false);
  await page.reload();
  await expect(body).toHaveText('第1段。第2段。');
  await expect.poll(() => pendingCount(page)).toBe(0);
});
