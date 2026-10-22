import { Capacitor } from '@capacitor/core';
import {
  createBrowserFileSaver,
  createIndexedDbStorage,
  openAppDb,
  type Platform,
} from '@oc/core';
import { installBackgroundMicGuard } from './backgroundMicGuard';
import { createCapacitorFileSaver } from './capacitorFileSaver';

/** Web and the Capacitor Android app (M5). M4 adds Electron. */
export async function selectPlatform(): Promise<Platform> {
  const db = await openAppDb();
  const isCapacitorApp = Capacitor.isNativePlatform();
  // Android silences a backgrounded app's microphone; end the recording there instead.
  if (isCapacitorApp) installBackgroundMicGuard();
  return {
    storage: createIndexedDbStorage(db),
    fileSaver: isCapacitorApp ? createCapacitorFileSaver() : createBrowserFileSaver(),
    // Android's WebView has no window.print(), so the app hides 匯出 PDF.
    canPrint: !isCapacitorApp,
  };
}
