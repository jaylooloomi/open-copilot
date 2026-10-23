// @vitest-environment node
// (esbuild, which vite.config.ts pulls in, refuses to load under jsdom.)
import { describe, expect, it } from 'vitest';
import config, {
  API_PROXY_PATH,
  API_PROXY_TARGET,
  PWA_OPTIONS,
  SHARE_ALLOWED_HOSTS,
  THEME_COLOR,
  isNetworkOnlyRequest,
  stripApiPrefix,
} from '../vite.config';

interface ProxyRule {
  target: string;
  changeOrigin: boolean;
  rewrite: (path: string) => string;
}

/** Plugin names, with the nested plugin arrays (VitePWA returns several) flattened. */
function pluginNames(plugins: unknown): string[] {
  if (Array.isArray(plugins)) return plugins.flatMap(pluginNames);
  if (plugins && typeof plugins === 'object' && 'name' in plugins) {
    return [String((plugins as { name: unknown }).name)];
  }
  return [];
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

  it('lets Cloudflare quick tunnel hosts reach only the built app (vite preview), never the dev server', () => {
    expect(SHARE_ALLOWED_HOSTS).toEqual(['.trycloudflare.com']);
    // npm run prototype -- --share tunnels `vite preview` (4173): built files and /api only.
    expect(config.preview?.allowedHosts).toBe(SHARE_ALLOWED_HOSTS);
    // The dev server (/@fs/, HMR, source transforms) answers localhost only.
    expect(config.server?.allowedHosts).toBeUndefined();
  });

  it('gives vite preview the same /api proxy as the dev server', () => {
    const proxy = config.preview?.proxy as Record<string, ProxyRule>;
    expect(proxy).toBe(config.server?.proxy);
    expect(Object.keys(proxy)).toEqual([API_PROXY_PATH]);
  });

  it('builds a PWA (generateSW, autoUpdate) that src/main.tsx registers itself', () => {
    expect(pluginNames(config.plugins)).toContain('vite-plugin-pwa');
    // injectRegister: false, so Electron and Android never get a registerSW.js script.
    expect(PWA_OPTIONS).toMatchObject({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      injectRegister: false,
    });
  });

  it('describes the app in the manifest with the brand color and three icons', () => {
    expect(THEME_COLOR).toBe('#c026d3');
    expect(PWA_OPTIONS.manifest).toMatchObject({
      name: 'open-copilot',
      short_name: 'open-copilot',
      lang: 'zh-TW',
      display: 'standalone',
      start_url: '/',
      scope: '/',
      theme_color: THEME_COLOR,
      background_color: THEME_COLOR,
    });
    expect((PWA_OPTIONS.manifest as { icons?: unknown }).icons).toEqual([
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
  });

  it('activates a new service worker at once and takes over open pages (autoUpdate)', () => {
    // vite-plugin-pwa only adds these itself when it injects the register script, and this app
    // turns that off (injectRegister: false), so they must be set here.
    expect(PWA_OPTIONS.workbox).toMatchObject({ skipWaiting: true, clientsClaim: true });
  });

  it('precaches the app files and never caches the backend or other origins', () => {
    const workbox = PWA_OPTIONS.workbox!;
    expect(workbox.globPatterns).toEqual(['**/*.{js,css,html,png,svg}']);
    expect(workbox.navigateFallback).toBe('index.html');
    expect(workbox.navigateFallbackDenylist?.map(String)).toEqual([String(/^\/api(?:[/?]|$)/)]);
    expect(workbox.runtimeCaching).toEqual([{ urlPattern: isNetworkOnlyRequest, handler: 'NetworkOnly' }]);

    const at = (href: string, sameOrigin = true) => isNetworkOnlyRequest({ url: new URL(href), sameOrigin });
    expect(at('https://quiet-river-1234.trycloudflare.com/api/transcribe')).toBe(true);
    expect(at('http://localhost:4173/api')).toBe(true);
    expect(at('http://localhost:4173/api?probe=1')).toBe(true);
    expect(at('https://api.example.com/transcribe', false)).toBe(true);
    expect(at('https://fonts.example.com/font.woff2', false)).toBe(true);
    expect(at('http://localhost:4173/')).toBe(false);
    expect(at('http://localhost:4173/assets/index-abc123.js')).toBe(false);
    expect(at('http://localhost:4173/apiary.png')).toBe(false);
  });

  it('uses one /api pattern for the proxy, the navigation denylist and the network-only route', () => {
    const apiPattern = new RegExp(API_PROXY_PATH);
    expect(PWA_OPTIONS.workbox!.navigateFallbackDenylist).toEqual([apiPattern]);
    // isNetworkOnlyRequest must inline its regex (workbox serializes it), so compare the source text.
    expect(isNetworkOnlyRequest.toString()).toContain(String(apiPattern));
  });

  it('keeps the network-only route self-contained, because workbox copies its source into sw.js', () => {
    const copy = new Function(`return (${isNetworkOnlyRequest.toString()});`)() as typeof isNetworkOnlyRequest;
    expect(copy({ url: new URL('http://localhost/api/health'), sameOrigin: true })).toBe(true);
    expect(copy({ url: new URL('http://localhost/'), sameOrigin: true })).toBe(false);
  });
});
