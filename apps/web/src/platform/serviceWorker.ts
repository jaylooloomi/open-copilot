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

/** The part of vite-plugin-pwa's `registerSW` options this app uses. */
interface PwaRegisterOptions {
  immediate?: boolean;
  onRegisteredSW?: (swScriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: unknown) => void;
  /** Called when a new service worker took over; without it vite-plugin-pwa reloads at once. */
  onNeedReload?: () => void;
}

/**
 * Calls vite-plugin-pwa's `registerSW` and settles when it reports back. `registerSW` returns at
 * once and reports a failed registration (SecurityError, a missing sw.js) only through
 * `onRegisterError`, so this turns that callback into a rejection that registerServiceWorker
 * warns about. In `vite dev` registerSW is a no-op and the promise never settles, which is harmless.
 * `onNeedReload` replaces vite-plugin-pwa's immediate reload after an update (see updateReloadGate).
 */
export function registerWithPwa(
  registerSW: (options: PwaRegisterOptions) => unknown,
  onNeedReload?: () => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    registerSW({
      immediate: true,
      onRegisteredSW: () => resolve(),
      onRegisterError: (error) => reject(error),
      ...(onNeedReload ? { onNeedReload } : {}),
    });
  });
}
