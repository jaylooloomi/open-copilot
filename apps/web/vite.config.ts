import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The local backend started by `npm run prototype` (apps/api). */
export const API_PROXY_TARGET = 'http://localhost:8787';
/** `/api`, `/api/...` and `/api?...`, but not lookalikes such as `/apiary`. */
export const API_PROXY_PATH = '^/api(?:[/?]|$)';

/**
 * Hosts a Cloudflare quick tunnel uses (`npm run prototype -- --share`), e.g.
 * quiet-river-1234.trycloudflare.com. Vite rejects any other non-localhost Host with 403.
 */
export const SHARE_ALLOWED_HOSTS = ['.trycloudflare.com'];

/** `/api/transcribe` → `/transcribe`, `/api` → `/`; the query string is kept. */
export function stripApiPrefix(path: string): string {
  const stripped = path.replace(/^\/api(?=[/?]|$)/, '');
  return stripped.startsWith('/') ? stripped : `/${stripped}`;
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // The share URL (npm run prototype -- --share) reaches this server through a quick tunnel.
    allowedHosts: SHARE_ALLOWED_HOSTS,
    // apps/web/android is the Capacitor project; Gradle writes thousands of files there.
    watch: { ignored: ['**/android/**'] },
    // Same-origin backend for the prototype: http://localhost:5173/api/* → http://localhost:8787/*,
    // so the web app needs no CORS, and a shared tunnel URL (M9) reaches the backend the same way.
    proxy: {
      [API_PROXY_PATH]: { target: API_PROXY_TARGET, changeOrigin: true, rewrite: stripApiPrefix },
    },
  },
  // A busy 4173 should fail `vite preview`, not silently move it to 4174+.
  preview: { port: 4173, strictPort: true },
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
