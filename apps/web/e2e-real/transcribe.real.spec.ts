import { expect, test } from '@playwright/test';
import {
  encodeSetupHash,
  KEYWORDS,
  REAL_E2E_SUPPORTED,
  resolveRealProvider,
  SIMPLIFIED_SAMPLES,
} from './realEnv';

/** The fake microphone plays the ~22 s WAV (Chromium loops it); 25 s gives two or three segments. */
const RECORD_MS = 25_000;

test('真實語音：合成的中文語音經真的後端轉寫成繁體中文', async ({ page }, testInfo) => {
  test.skip(!REAL_E2E_SUPPORTED, '需要 Windows：測試音訊用 System.Speech 合成');
  const provider = resolveRealProvider(process.env, process.platform);
  testInfo.annotations.push({ type: 'provider', description: String(provider) });
  console.log(`[e2e:real] transcribe provider: ${provider}`);

  const accessKey = process.env['OC_REAL_ACCESS_KEY'];
  expect(accessKey, 'set by playwright.real.config.ts').toBeTruthy();

  await page.goto(`/${encodeSetupHash({ apiBaseUrl: 'http://localhost:5173/api', accessKey: accessKey! })}`);
  // Its label changes with the recording state, so match the class and still require a button.
  const record = page.locator('.oc-record-btn').and(page.getByRole('button'));
  await expect(record).toHaveText('錄製');
  await expect(record).toBeEnabled();
  expect(new URL(page.url()).hash).toBe('');

  const body = page.getByRole('textbox', { name: '筆記內文' });
  await body.click();
  await record.click();
  await expect(record).toHaveText('停止');
  await page.waitForTimeout(RECORD_MS);
  await record.click();
  await expect(record).toHaveText('錄製', { timeout: 120_000 });

  const text = (await body.textContent()) ?? '';
  console.log(`[e2e:real] transcript (${provider}): ${text}`);
  testInfo.annotations.push({ type: 'transcript', description: text });

  const found = KEYWORDS.filter((keyword) => text.includes(keyword));
  expect(found.length, `keywords found: ${found.join('、') || 'none'}`).toBeGreaterThanOrEqual(2);
  for (const sample of SIMPLIFIED_SAMPLES) {
    expect(text, `simplified character ${sample}`).not.toContain(sample);
  }
  await expect(page.locator('[data-transcript-gap]')).toHaveCount(0);
});
