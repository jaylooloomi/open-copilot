import { detectPlatformKind, selectPlatform } from './platform/selectPlatform';
import { registerServiceWorker } from './platform/serviceWorker';
import { startApp } from './startApp';

await startApp(document.getElementById('root') as HTMLElement, selectPlatform);

// Offline cache for the web app only (add-ons design 4). In `vite dev` registerSW is a no-op.
void registerServiceWorker(detectPlatformKind(), async () => {
  const { registerSW } = await import('virtual:pwa-register');
  registerSW({ immediate: true });
});
