import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../capacitor.config';

describe('capacitor.config', () => {
  it('builds the Android app from dist and serves it from https://localhost', () => {
    expect(config).toEqual({
      appId: 'com.think4u.opencopilot',
      appName: 'open-copilot',
      webDir: 'dist',
      server: { androidScheme: 'https' },
    });
  });

  it('serves the Android app from an origin the API accepts by default (CORS)', () => {
    // Read the API config as text so the web package does not import API source code.
    const apiConfig = readFileSync(resolve(__dirname, '../../api/src/config.ts'), 'utf8');
    const defaults = /DEFAULT_ALLOWED_ORIGINS[^=]*=\s*\[([^\]]*)\]/.exec(apiConfig)?.[1] ?? '';
    const origins = [...defaults.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    const androidOrigin = `${config.server?.androidScheme ?? 'https'}://localhost`;
    expect(origins).toContain(androidOrigin);
  });
});
