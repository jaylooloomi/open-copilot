// @vitest-environment node
import { describe, expect, it } from 'vitest';
import config from '../playwright.config';

interface Server {
  command: string;
  url: string;
  reuseExistingServer: boolean;
}

describe('playwright.config', () => {
  it('runs the dev-server e2e and the PWA e2e against the production build', () => {
    expect(
      config.projects?.map((project) => [
        project.name,
        project.testDir ?? config.testDir,
        project.use?.baseURL ?? config.use?.baseURL,
      ]),
    ).toEqual([
      ['chromium', './e2e', 'http://localhost:5173'],
      ['pwa', './e2e-pwa', 'http://localhost:4173'],
    ]);
  });

  it('starts the dev server and a fresh build behind vite preview', () => {
    const servers = config.webServer as Server[];
    expect(servers.map((server) => [server.command, server.url])).toEqual([
      ['npm run dev', 'http://localhost:5173'],
      ['npm run build && npm run preview', 'http://localhost:4173'],
    ]);
    // Never test an old build that happens to be served on 4173.
    expect(servers[1]!.reuseExistingServer).toBe(false);
  });
});
