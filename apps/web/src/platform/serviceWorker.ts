import type { PlatformKind } from './selectPlatform';

/**
 * Registers the PWA service worker (add-ons design 4), but only in a plain browser: the Electron
 * app (app://) and the Android app (Capacitor) ship their files themselves. Resolves to whether
 * it registered. A failed registration only warns; the app works without a service worker.
 */
export async function registerServiceWorker(
  kind: PlatformKind,
  register: () => Promise<void>,
  nav: object = navigator,
): Promise<boolean> {
  if (kind !== 'web' || !('serviceWorker' in nav)) return false;
  try {
    await register();
    return true;
  } catch (error) {
    console.warn('Service worker registration failed', error);
    return false;
  }
}
