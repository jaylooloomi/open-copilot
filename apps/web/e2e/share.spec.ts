import { request as httpRequest } from 'node:http';
import { devices, expect, test } from '@playwright/test';

// The phone that opens the share URL: a typical Android phone (412 CSS px, touch, Android Chrome).
// defaultBrowserType is left out: it would force a new worker, and this project is Chromium anyway.
const { defaultBrowserType: _browserType, ...pixel7 } = devices['Pixel 7'];
test.use(pixel7);

/** Status of GET / on the dev server when the request says it is for `host` (as a tunnel does). */
function statusForHost(baseURL: string, host: string): Promise<number> {
  const { hostname, port } = new URL(baseURL);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: hostname, port: Number(port), path: '/', headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.setTimeout(5_000, () => req.destroy(new Error(`dev server did not answer for host ${host} within 5 s`)));
    req.on('error', reject);
    req.end();
  });
}

test('開發伺服器接受 Cloudflare quick tunnel 的網域，其他網域仍然擋下', async ({ baseURL }) => {
  expect(baseURL).toBeTruthy();
  expect(await statusForHost(baseURL!, 'quiet-river-1234.trycloudflare.com')).toBe(200);
  expect(await statusForHost(baseURL!, 'evil.example')).toBe(403);
});
