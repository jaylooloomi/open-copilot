import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // apps/web/android is the Capacitor project; Gradle writes thousands of files there.
    watch: { ignored: ['**/android/**'] },
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
