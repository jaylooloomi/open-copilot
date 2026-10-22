// @vitest-environment node
// (esbuild, which vite.config.ts pulls in, refuses to load under jsdom.)
import { describe, expect, it } from 'vitest';
import config from '../vite.config';

describe('vite.config', () => {
  it('fails fast instead of drifting when the dev or preview port is busy', () => {
    expect(config.server).toMatchObject({ port: 5173, strictPort: true });
    expect(config.preview).toMatchObject({ port: 4173, strictPort: true });
  });
});
