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
});
