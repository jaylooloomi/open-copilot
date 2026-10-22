// @vitest-environment node
// (esbuild, which vite.config.ts pulls in, refuses to load under jsdom.)
import { describe, expect, it } from 'vitest';
import config from '../vite.config';

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
});
