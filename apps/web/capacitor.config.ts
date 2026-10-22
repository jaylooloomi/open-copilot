import type { CapacitorConfig } from '@capacitor/cli';

/** Capacitor (Android) shell around the Vite build in dist/. */
const config: CapacitorConfig = {
  appId: 'com.think4u.opencopilot',
  appName: 'open-copilot',
  webDir: 'dist',
  server: {
    // The app is served from https://localhost: a secure context (getUserMedia works) and an
    // origin M3a's default ALLOWED_ORIGINS already accepts.
    androidScheme: 'https',
  },
};

export default config;
