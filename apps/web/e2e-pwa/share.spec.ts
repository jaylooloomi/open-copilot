import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// npm run prototype -- --share tunnels `vite preview` (the built app, 4173): through the tunnel only
// the files in apps/web/dist and /api are reachable, never the repo (the dev server's /@fs/).

const TUNNEL_HOST = 'quiet-river-1234.trycloudflare.com';

/** GET `path` on vite preview with the Host a quick tunnel sends. */
function getForHost(baseURL: string, host: string, path: string): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(baseURL);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: hostname, port: Number(port), path, headers: { host } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.setTimeout(5_000, () => req.destroy(new Error(`vite preview did not answer for host ${host} within 5 s`)));
    req.on('error', reject);
    req.end();
  });
}

test('建置版接受 quick tunnel 的網域，其他網域仍然擋下', async ({ baseURL }) => {
  expect(baseURL).toBeTruthy();
  const page = await getForHost(baseURL!, TUNNEL_HOST, '/');
  expect(page.status).toBe(200);
  expect(page.body).toContain('<div id="root">');
  expect((await getForHost(baseURL!, 'evil.example', '/')).status).toBe(403);
});

test('經過通道讀不到 repo 裡的檔案（沒有 /@fs/）', async ({ baseURL }) => {
  expect(baseURL).toBeTruthy();
  const specFile = fileURLToPath(
    new URL('../../../docs/superpowers/specs/2026-10-22-v1-addons-design.md', import.meta.url),
  );
  const marker = readFileSync(specFile, 'utf8').split(/\r?\n/).find((line) => line.trim() !== '')!;
  const fsPath = `/@fs/${specFile.replace(/\\/g, '/').replace(/^\//, '')}`;
  for (const path of [fsPath, `${fsPath}?raw`, '/package.json', '/src/main.tsx', '/vite.config.ts']) {
    const response = await getForHost(baseURL!, TUNNEL_HOST, path);
    // vite preview answers unknown paths with index.html (or 404), never with the file itself.
    expect(response.body, path).not.toContain(marker);
    expect(response.body, path).not.toContain('"workspaces"');
    expect(response.body, path).not.toContain('registerServiceWorker');
    expect(response.body, path).not.toContain('SHARE_ALLOWED_HOSTS');
  }
});
