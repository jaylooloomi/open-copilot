import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { devices, expect, test, type Page } from '@playwright/test';

// The phone that opens the share URL: a typical Android phone (412 CSS px, touch, Android Chrome).
// defaultBrowserType is left out: it would force a new worker, and this project is Chromium anyway.
const { defaultBrowserType: _browserType, ...pixel7 } = devices['Pixel 7'];
test.use(pixel7);

/**
 * What the phone opens: <tunnel>/#oc-setup=… with apiBaseUrl <tunnel>/api (shareSetupUrl in
 * scripts/prototype/lib.mjs). The dev server stands in for the tunnel origin (the real share mode
 * tunnels `vite preview`; e2e-pwa/share.spec.ts checks that one), and page.route
 * answers /api before the Vite proxy, so no backend is involved. The API URL is built from
 * baseURL so it stays same-origin with the page, which #oc-setup requires.
 */
const ACCESS_KEY = 'share-key-0123456789';

/** What scripts/prototype.mjs puts after #oc-setup=. */
const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

/** Status of GET `path` on the dev server when the request says it is for `host` (as a tunnel does). */
function statusForHost(baseURL: string, host: string, path = '/'): Promise<number> {
  const { hostname, port } = new URL(baseURL);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: hostname, port: Number(port), path, headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.setTimeout(5_000, () => req.destroy(new Error(`dev server did not answer for host ${host} within 5 s`)));
    req.on('error', reject);
    req.end();
  });
}

/** Whether a saved note body (IndexedDB store `notes`) contains `text`. */
function savedNotesContain(page: Page, text: string): Promise<boolean> {
  return page.evaluate(
    (needle) =>
      new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open('open-copilot');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          try {
            const request = db.transaction('notes', 'readonly').objectStore('notes').getAll();
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              db.close();
              resolve(JSON.stringify(request.result).includes(needle));
            };
          } catch (error) {
            // A missing store throws here; pass it on instead of leaving the poll to time out.
            db.close();
            reject(error);
          }
        };
      }),
    text,
  );
}

test('開發伺服器不接受 Cloudflare quick tunnel 的網域（分享模式改用建置版），本機照常', async ({ baseURL }) => {
  expect(baseURL).toBeTruthy();
  const repoPackageJson = fileURLToPath(new URL('../../../package.json', import.meta.url)).replace(/\\/g, '/');
  const fsPath = `/@fs/${repoPackageJson.replace(/^\//, '')}`;
  // Through localhost the dev server works as usual (and can read the repo, as Vite needs to).
  expect(await statusForHost(baseURL!, 'localhost:5173')).toBe(200);
  expect(await statusForHost(baseURL!, 'localhost:5173', fsPath)).toBe(200);
  // A tunnel Host reaches nothing: not the page, and not /@fs/ (repo files).
  expect(await statusForHost(baseURL!, 'quiet-river-1234.trycloudflare.com')).toBe(403);
  expect(await statusForHost(baseURL!, 'quiet-river-1234.trycloudflare.com', fsPath)).toBe(403);
  expect(await statusForHost(baseURL!, 'evil.example')).toBe(403);
});

test('手機開啟分享網址：自動填好設定，錄音轉寫後重新整理內容仍在', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  expect(baseURL).toBeTruthy();
  const SHARE_API = new URL('/api', baseURL).href;
  const authorization: (string | undefined)[] = [];
  await page.route(`${SHARE_API}/health`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
  );
  await page.route(`${SHARE_API}/transcribe`, async (route) => {
    authorization.push(route.request().headers()['authorization']);
    const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
    const seq = Number(/name="seq"\r\n\r\n(\d+)/.exec(body)?.[1] ?? '0');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ seq, text: `手機第${seq}段。` }),
    });
  });

  await page.goto(`/#oc-setup=${encode({ apiBaseUrl: SHARE_API, accessKey: ACCESS_KEY })}`);

  // Its label changes with the recording state, so match the class and still require a button.
  const record = page.locator('.oc-record-btn').and(page.getByRole('button'));
  await expect(record).toHaveText('錄製');
  expect(new URL(page.url()).hash).toBe('');
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

  const body = page.getByRole('textbox', { name: '筆記內文' });
  await body.tap();
  await record.tap();
  await expect(record).toHaveText('停止');

  // The first cut comes after 8–12 seconds; stopping then sends the rest.
  await expect.poll(() => authorization.length, { timeout: 25_000 }).toBeGreaterThan(0);
  // Let the tail segment hold real audio before stopping (an instant stop can yield an empty Blob).
  await page.waitForTimeout(1_500);
  await record.tap();

  await expect(record).toHaveText('錄製', { timeout: 15_000 });
  await expect(body).toContainText('手機第1段。');
  expect(authorization.every((value) => value === `Bearer ${ACCESS_KEY}`)).toBe(true);

  await expect.poll(() => savedNotesContain(page, '手機第1段。')).toBe(true);
  await page.reload();
  await expect(page.getByRole('textbox', { name: '筆記內文' })).toContainText('手機第1段。');
  await expect(record).toHaveText('錄製');
});
