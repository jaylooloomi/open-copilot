import { detectPlatformKind, selectPlatform } from './platform/selectPlatform';
import { registerServiceWorker, registerWithPwa } from './platform/serviceWorker';
import { createUpdateReloadGate, trackPageActivity } from './platform/updateReloadGate';
import { startApp } from './startApp';

const platformKind = detectPlatformKind();
// Installed before the app starts so every microphone track and upload is seen. A new deploy then
// reloads the page only once no recording or upload is running (add-ons design 4).
const activity = platformKind === 'web' ? trackPageActivity() : undefined;

await startApp(document.getElementById('root') as HTMLElement, selectPlatform);

// Offline cache for the web app only (add-ons design 4). It is registered after the app starts on
// purpose: the service worker is optional, and the app must not wait on it. In `vite dev`
// registerSW is a no-op.
void registerServiceWorker(platformKind, async () => {
  const { registerSW } = await import('virtual:pwa-register');
  await registerWithPwa(registerSW, activity && createUpdateReloadGate({ isBusy: activity.isBusy }));
});
