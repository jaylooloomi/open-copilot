import { request as httpRequest } from 'node:http';
import { devices, expect, test } from '@playwright/test';

// The phone that opens the share URL: a typical Android phone (412 CSS px, touch, Android Chrome).
// defaultBrowserType is left out: it would force a new worker, and this project is Chromium anyway.
const { defaultBrowserType: _browserType, ...pixel7 } = devices['Pixel 7'];
test.use(pixel7);

/** Status of GET / on the dev server when the request says it is for `host` (as a tunnel does). */
function statusForHost(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: 'localhost', port: 5173, path: '/', headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

test('開發伺服器接受 Cloudflare quick tunnel 的網域，其他網域仍然擋下', async () => {
  expect(await statusForHost('quiet-river-1234.trycloudflare.com')).toBe(200);
  expect(await statusForHost('evil.example')).toBe(403);
});
