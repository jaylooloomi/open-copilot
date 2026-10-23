// @vitest-environment node
// (esbuild, which vite.config.ts pulls in, refuses to load under jsdom.)
import { describe, expect, it } from 'vitest';
import config, {
  API_PROXY_PATH,
  API_PROXY_TARGET,
  SHARE_ALLOWED_HOSTS,
  stripApiPrefix,
} from '../vite.config';

interface ProxyRule {
  target: string;
  changeOrigin: boolean;
  rewrite: (path: string) => string;
}

describe('vite.config', () => {
  it('fails fast instead of drifting when the dev or preview port is busy', () => {
    expect(config.server).toMatchObject({ port: 5173, strictPort: true });
    expect(config.preview).toMatchObject({ port: 4173, strictPort: true });
  });

  it('keeps the dev server out of the Android project', () => {
    // Only index.html is an entry, not the build copy in android/app/src/main/assets/public.
    expect(config.optimizeDeps?.entries).toEqual(['index.html']);
    // Gradle writes thousands of files under android/; do not watch them.
    expect(config.server?.watch?.ignored).toEqual(['**/android/**']);
  });

  it('proxies /api/* to the local backend on 8787 without the /api prefix', () => {
    const proxy = config.server?.proxy as Record<string, ProxyRule>;
    expect(Object.keys(proxy)).toEqual([API_PROXY_PATH]);
    expect(API_PROXY_TARGET).toBe('http://localhost:8787');
    expect(proxy[API_PROXY_PATH]).toMatchObject({ target: API_PROXY_TARGET, changeOrigin: true });
    expect(proxy[API_PROXY_PATH]!.rewrite).toBe(stripApiPrefix);
  });

  it('matches /api and its sub-paths only', () => {
    const matches = new RegExp(API_PROXY_PATH);
    for (const path of ['/api', '/api/', '/api/transcribe', '/api/health', '/api?probe=1']) {
      expect(matches.test(path), path).toBe(true);
    }
    for (const path of ['/apiary', '/', '/src/main.tsx', '/mock-api/health', '/x/api/health']) {
      expect(matches.test(path), path).toBe(false);
    }
  });

  it('strips the /api prefix and keeps the query string', () => {
    expect(stripApiPrefix('/api/transcribe')).toBe('/transcribe');
    expect(stripApiPrefix('/api/ai/summary')).toBe('/ai/summary');
    expect(stripApiPrefix('/api')).toBe('/');
    expect(stripApiPrefix('/api?probe=1')).toBe('/?probe=1');
  });

  it('lets Cloudflare quick tunnel hosts reach the dev server (npm run prototype -- --share)', () => {
    expect(SHARE_ALLOWED_HOSTS).toEqual(['.trycloudflare.com']);
    expect(config.server?.allowedHosts).toBe(SHARE_ALLOWED_HOSTS);
    // vite preview inherits server.allowedHosts and server.proxy, so a tunnel to 4173 works too.
    expect(config.preview?.allowedHosts).toBeUndefined();
    expect(config.preview?.proxy).toBeUndefined();
  });
});
