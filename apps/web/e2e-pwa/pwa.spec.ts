import { expect, test, type Page } from '@playwright/test';

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface Manifest {
  name: string;
  short_name: string;
  lang: string;
  display: string;
  start_url: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
}

/** Waits until the service worker is active and controls the page; returns its script URL. */
async function waitForServiceWorker(page: Page): Promise<string> {
  const scriptURL = await page.evaluate(
    async () => (await navigator.serviceWorker.ready).active?.scriptURL ?? '',
  );
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  return scriptURL;
}

/** Titles the app has persisted in IndexedDB (database "open-copilot", store "notes"). */
function savedTitles(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('open-copilot');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('notes', 'readonly').objectStore('notes').getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve((request.result as Array<{ title: string }>).map((note) => note.title));
          };
        };
      }),
  );
}

/** Pathnames of every request stored in any Cache Storage cache. */
function cachedPaths(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) paths.push(new URL(request.url).pathname);
    }
    return paths;
  });
}

test('建置版有 manifest 和三種圖示', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/manifest.webmanifest');

  const manifest = (await (await request.get(href!)).json()) as Manifest;
  expect(manifest).toMatchObject({
    name: 'open-copilot',
    short_name: 'open-copilot',
    lang: 'zh-TW',
    display: 'standalone',
    start_url: '/',
    theme_color: '#c026d3',
    background_color: '#c026d3',
  });
  expect(manifest.icons.map((icon) => [icon.src, icon.sizes, icon.purpose ?? 'any'])).toEqual([
    ['/icons/icon-192.png', '192x192', 'any'],
    ['/icons/icon-512.png', '512x512', 'any'],
    ['/icons/icon-maskable-512.png', '512x512', 'maskable'],
  ]);
  for (const icon of manifest.icons) {
    const response = await request.get(icon.src);
    expect(response.status(), icon.src).toBe(200);
    expect(response.headers()['content-type'], icon.src).toBe('image/png');
  }
});

test('service worker 已註冊並控制頁面', async ({ page }) => {
  await page.goto('/');
  const scriptURL = await waitForServiceWorker(page);
  expect(new URL(scriptURL).pathname).toBe('/sw.js');
});

test('離線時重新整理仍看得到筆記，/api 不會進快取', async ({ page, context }) => {
  await page.goto('/');
  await waitForServiceWorker(page);

  await page.getByRole('textbox', { name: '標題' }).fill('離線測試筆記');
  await expect.poll(() => savedTitles(page)).toContain('離線測試筆記');

  // Whatever answers (or not), a backend request must never be stored.
  await page.evaluate(() => fetch('/api/health').then(() => undefined, () => undefined));
  const cached = await cachedPaths(page);
  expect(cached).toContain('/index.html');
  expect(cached.filter((path) => /^\/api(?:[/?]|$)/.test(path))).toEqual([]);

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole('textbox', { name: '標題' })).toHaveValue('離線測試筆記');
  } finally {
    await context.setOffline(false);
  }
});
