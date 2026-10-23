import { Capacitor } from '@capacitor/core';
import {
  createBrowserFileSaver,
  createIndexedDbStorage,
  openAppDb,
  type FileSaver,
  type Platform,
} from '@oc/core';
import { installBackgroundMicGuard } from './backgroundMicGuard';
import { createCapacitorFileSaver } from './capacitorFileSaver';
import { createDesktopFileSaver } from './desktopFileSaver';

/** Which shell runs this page: a plain browser, Electron (M4) or the Capacitor Android app (M5). */
export type PlatformKind = 'web' | 'desktop' | 'android';

export function detectPlatformKind(
  location: Pick<Location, 'protocol'> = window.location,
): PlatformKind {
  if (Capacitor.isNativePlatform()) return 'android';
  // apps/desktop serves the page from app://bundle and its preload exposes window.ocDesktop.
  if (window.ocDesktop || location.protocol === 'app:') return 'desktop';
  return 'web';
}

/** Web, Electron (M4) and the Capacitor Android app (M5). */
export async function selectPlatform(): Promise<Platform> {
  const db = await openAppDb();
  const isCapacitorApp = detectPlatformKind() === 'android';
  // Android silences a backgrounded app's microphone; end the recording there instead.
  if (isCapacitorApp) installBackgroundMicGuard();
  return {
    storage: createIndexedDbStorage(db),
    fileSaver: isCapacitorApp ? createCapacitorFileSaver() : selectFileSaver(),
    // Android's WebView has no window.print(), so the app hides 匯出 PDF.
    canPrint: !isCapacitorApp,
  };
}

function selectFileSaver(): FileSaver {
  // apps/desktop's preload script exposes window.ocDesktop; browsers do not have it.
  // Read once at startup: preload runs before page scripts, so the bridge already exists.
  const desktop = window.ocDesktop;
  return desktop ? createDesktopFileSaver(desktop) : createBrowserFileSaver();
}
