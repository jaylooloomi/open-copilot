import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA, type VitePWAOptions } from 'vite-plugin-pwa';

/** The local backend started by `npm run prototype` (apps/api). */
export const API_PROXY_TARGET = 'http://localhost:8787';
/** `/api`, `/api/...` and `/api?...`, but not lookalikes such as `/apiary`. */
export const API_PROXY_PATH = '^/api(?:[/?]|$)';
/**
 * Hosts a Cloudflare quick tunnel uses (`npm run prototype -- --share`), e.g.
 * quiet-river-1234.trycloudflare.com. Only `vite preview` (the built app) accepts them; the dev
 * server keeps Vite's default (localhost only), because through a public tunnel its `/@fs/`
 * endpoint would let anyone read the files in the repo.
 */
export const SHARE_ALLOWED_HOSTS = ['.trycloudflare.com'];
/** The brand color: --oc-primary in packages/core/src/styles/app.css and theme-color in index.html. */
export const THEME_COLOR = '#c026d3';

/** `/api/transcribe` → `/transcribe`, `/api` → `/`; the query string is kept. */
export function stripApiPrefix(path: string): string {
  const stripped = path.replace(/^\/api(?=[/?]|$)/, '');
  return stripped.startsWith('/') ? stripped : `/${stripped}`;
}

/**
 * Requests the service worker must never answer from a cache: the backend (`/api`, `/api/...`)
 * and anything on another origin. generateSW copies this function's source into sw.js, so it
 * must not use anything outside its own body.
 */
export function isNetworkOnlyRequest({ url, sameOrigin }: { url: URL; sameOrigin: boolean }): boolean {
  return !sameOrigin || /^\/api(?:[/?]|$)/.test(url.pathname);
}

/** PWA (add-ons design 4). src/main.tsx registers the service worker, and only in browsers. */
export const PWA_OPTIONS: Partial<VitePWAOptions> = {
  strategies: 'generateSW',
  registerType: 'autoUpdate',
  // No registerSW.js in index.html: Electron (app://) and Android (Capacitor) must not register.
  injectRegister: false,
  manifest: {
    name: 'open-copilot',
    short_name: 'open-copilot',
    description: '邊錄音邊轉成文字的語音筆記',
    lang: 'zh-TW',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: THEME_COLOR,
    background_color: THEME_COLOR,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    // autoUpdate: a new service worker activates at once and controls the open page, which
    // registerSW then reloads. vite-plugin-pwa sets these only when it injects the register script.
    skipWaiting: true,
    clientsClaim: true,
    // The app itself (including the lazily loaded docx chunk), so a reload works offline.
    globPatterns: ['**/*.{js,css,html,png,svg}'],
    maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
    navigateFallback: 'index.html',
    navigateFallbackDenylist: [new RegExp(API_PROXY_PATH)],
    runtimeCaching: [{ urlPattern: isNetworkOnlyRequest, handler: 'NetworkOnly' }],
  },
};

/**
 * Same-origin backend for the prototype: <web origin>/api/* → http://localhost:8787/*, so the web
 * app needs no CORS, and the share URL (M9) reaches the backend the same way.
 */
const API_PROXY = {
  [API_PROXY_PATH]: { target: API_PROXY_TARGET, changeOrigin: true, rewrite: stripApiPrefix },
};

export default defineConfig({
  plugins: [react(), VitePWA(PWA_OPTIONS)],
  server: {
    port: 5173,
    strictPort: true,
    // apps/web/android is the Capacitor project; Gradle writes thousands of files there.
    watch: { ignored: ['**/android/**'] },
    proxy: API_PROXY,
  },
  preview: {
    // A busy 4173 should fail `vite preview`, not silently move it to 4174+.
    port: 4173,
    strictPort: true,
    // The share URL (npm run prototype -- --share) reaches the built app through a quick tunnel.
    allowedHosts: SHARE_ALLOWED_HOSTS,
    proxy: API_PROXY,
  },
  optimizeDeps: {
    // Pre-bundle from the app entry only, not from the build copy in android/app/src/main/assets.
    entries: ['index.html'],
    // docx is only reachable through a dynamic import in @oc/core. Pre-bundle it at
    // startup so a stale optimizer cache cannot trigger a reload mid-session.
    include: ['docx'],
  },
  build: {
    // main.tsx uses top-level await.
    target: 'es2022',
    // Tiptap + React form one ~650 kB chunk; that is expected for this app.
    chunkSizeWarningLimit: 1000,
  },
});
