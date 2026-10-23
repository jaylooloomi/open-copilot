import { detectPlatformKind, selectPlatform } from './platform/selectPlatform';
import { registerServiceWorker, registerWithPwa } from './platform/serviceWorker';
import { startApp } from './startApp';

await startApp(document.getElementById('root') as HTMLElement, selectPlatform);

// Offline cache for the web app only (add-ons design 4). It is registered after the app starts on
// purpose: the service worker is optional, and the app must not wait on it. In `vite dev`
// registerSW is a no-op.
void registerServiceWorker(detectPlatformKind(), async () => {
  const { registerSW } = await import('virtual:pwa-register');
  await registerWithPwa(registerSW);
});
