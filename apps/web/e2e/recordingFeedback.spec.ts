import { expect, test, type Page, type Route } from '@playwright/test';

/** Mocked backend under the dev server's own origin (see recording.spec.ts); page.route answers it. */
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

/** Saved settings, so the record button is ready without the dialog. */
async function configure(page: Page) {
  await page.addInitScript((api) => {
    localStorage.setItem('oc.settings', JSON.stringify({ apiBaseUrl: api, accessKey: 'dev-key' }));
  }, API);
}

/**
 * Replaces the microphone with a 440 Hz tone whose loudness the test sets with setMicLevel():
 * 0 is total silence, 0.5 (RMS about 0.35) lights all five bars. Chrome's own fake device only
 * beeps now and then, which can test neither a full meter nor 10 quiet seconds.
 */
async function installToneMicrophone(page: Page, initialLevel: number) {
  await page.addInitScript((initial) => {
    let level = initial;
    let gain: GainNode | null = null;
    Object.assign(window, {
      __ocSetMicLevel: (value: number) => {
        level = value;
        if (gain) gain.gain.value = value;
      },
    });
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      oscillator.frequency.value = 440;
      const node = context.createGain();
      node.gain.value = level;
      gain = node;
      const destination = context.createMediaStreamDestination();
      oscillator.connect(node).connect(destination);
      oscillator.start();
      await context.resume().catch(() => undefined);
      return destination.stream;
    };
  }, initialLevel);
}

const setMicLevel = (page: Page, level: number) =>
  page.evaluate((value) => {
    (window as unknown as { __ocSetMicLevel(value: number): void }).__ocSetMicLevel(value);
  }, level);

test('錄音時顯示計時器、音量條與轉寫中段數，停止後計時器與音量條消失', async ({ page }) => {
  test.setTimeout(90_000);
  await configure(page);
  await installToneMicrophone(page, 0.5);
  const held: Route[] = [];
  let answerAtOnce = false;
  await page.route(`${API}/transcribe`, async (route) => {
    if (answerAtOnce) await transcript(route, seqOf(route));
    else held.push(route);
  });

  await page.goto('/');
  const record = page.locator('.oc-record-btn');
  const body = page.getByRole('textbox', { name: '筆記內文' });
  await expect(record).toHaveText('錄製');
  await expect(record).toBeEnabled();
  await body.click();

  await record.click();
  await expect(record).toHaveText('停止');
  const timer = page.getByRole('timer', { name: '錄音時間' });
  const meter = page.locator('.oc-level-meter');
  await expect(timer).toHaveText(/^00:0[0-2]$/);
  await expect(meter).toHaveAttribute('aria-hidden', 'true');
  await expect(meter).toHaveAttribute('data-level', '5');
  // A range, not an exact second: expect's polling backs off to 1 s steps and may skip 00:02.
  await expect(timer).toHaveText(/^00:0[2-9]$/, { timeout: 5_000 });

  // A pause cuts the first segment (once the policy's minimum length has passed) and empties the meter.
  await setMicLevel(page, 0);
  await expect(meter).toHaveAttribute('data-level', '0');
  await expect.poll(() => held.length, { timeout: 20_000 }).toBeGreaterThan(0);
  await setMicLevel(page, 0.5);
  const transcribing = page.getByText(/^轉寫中 \d+ 段$/);
  await expect(transcribing).toHaveText('轉寫中 1 段');

  // Same as recording.spec.ts: give the tail segment real audio before stopping.
  await page.waitForTimeout(1_500);
  await record.click();
  await expect(record).toHaveText('處理中');
  await expect(timer).toHaveCount(0);
  await expect(meter).toHaveCount(0);
  await expect(transcribing).toHaveText('轉寫中 2 段');

  answerAtOnce = true;
  for (const route of held.splice(0)) await transcript(route, seqOf(route));

  await expect(record).toHaveText('錄製', { timeout: 15_000 });
  await expect(transcribing).toHaveCount(0);
  await expect(body).toHaveText('第1段。第2段。');
});

test('超過 10 秒沒有聲音時提示確認麥克風，有聲音後提示消失', async ({ page }) => {
  test.setTimeout(60_000);
  await configure(page);
  await installToneMicrophone(page, 0);
  await page.route(`${API}/transcribe`, (route) => transcript(route, seqOf(route)));

  await page.goto('/');
  const record = page.locator('.oc-record-btn');
  await expect(record).toHaveText('錄製');
  await expect(record).toBeEnabled();
  await page.getByRole('textbox', { name: '筆記內文' }).click();

  await record.click();
  await expect(record).toHaveText('停止');
  const hint = page.getByText('沒有偵測到聲音，請確認麥克風');
  const meter = page.locator('.oc-level-meter');
  await expect(meter).toHaveAttribute('data-level', '0');

  // Not before 10 seconds…
  await page.waitForTimeout(8_000);
  await expect(hint).toHaveCount(0);
  // …but soon after.
  await expect(hint).toBeVisible({ timeout: 6_000 });
  await expect(hint).toHaveAttribute('role', 'status');

  await setMicLevel(page, 0.5);
  await expect(hint).toHaveCount(0);
  await expect(meter).toHaveAttribute('data-level', '5');

  await record.click();
  await expect(record).toHaveText('錄製', { timeout: 15_000 });
  await expect(page.getByRole('timer')).toHaveCount(0);
  await expect(meter).toHaveCount(0);
  await expect(hint).toHaveCount(0);
});

test('手機寬度錄音時，錄音狀態不會把設定鈕擠出畫面，頁面也不會橫向捲動', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await configure(page);
  await installToneMicrophone(page, 0.5);
  const held: Route[] = [];
  let answerAtOnce = false;
  await page.route(`${API}/transcribe`, async (route) => {
    if (answerAtOnce) await transcript(route, seqOf(route));
    else held.push(route);
  });

  await page.goto('/');
  const record = page.locator('.oc-record-btn');
  await expect(record).toHaveText('錄製');
  await expect(record).toBeEnabled();
  await page.getByRole('textbox', { name: '筆記內文' }).click();

  await record.click();
  await expect(record).toHaveText('停止');
  // Hold the first segment, so 轉寫中 1 段 sits beside the timer and the meter: the widest status.
  await setMicLevel(page, 0);
  await expect.poll(() => held.length, { timeout: 20_000 }).toBeGreaterThan(0);
  await setMicLevel(page, 0.5);
  await expect(page.getByText(/^轉寫中 \d+ 段$/)).toBeVisible();
  await expect(page.getByRole('timer', { name: '錄音時間' })).toBeVisible();
  await expect(page.locator('.oc-level-meter')).toBeVisible();

  // The gear stays on the record button's row and inside the screen.
  const recordBox = await record.boundingBox();
  const gear = await page.getByRole('button', { name: '設定', exact: true }).boundingBox();
  expect(gear!.x + gear!.width).toBeLessThanOrEqual(375);
  expect(Math.abs(recordBox!.y + recordBox!.height / 2 - (gear!.y + gear!.height / 2))).toBeLessThan(4);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);

  answerAtOnce = true;
  for (const route of held.splice(0)) await transcript(route, seqOf(route));
  // Same as recording.spec.ts: give the tail segment real audio before stopping.
  await page.waitForTimeout(1_500);
  await record.click();
  await expect(record).toHaveText('錄製', { timeout: 15_000 });
  await expect(page.getByText(/^轉寫中 \d+ 段$/)).toHaveCount(0);
});
