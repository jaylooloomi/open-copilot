import {
  createBrowserFileSaver,
  createIndexedDbStorage,
  openAppDb,
  type FileSaver,
  type Platform,
} from '@oc/core';
import { createDesktopFileSaver } from './desktopFileSaver';

/** Web and Electron (M4). M5 adds Capacitor. */
export async function selectPlatform(): Promise<Platform> {
  const db = await openAppDb();
  return {
    storage: createIndexedDbStorage(db),
    fileSaver: selectFileSaver(),
    canPrint: true,
  };
}

function selectFileSaver(): FileSaver {
  // apps/desktop's preload script exposes window.ocDesktop; browsers do not have it.
  const desktop = window.ocDesktop;
  return desktop ? createDesktopFileSaver(desktop) : createBrowserFileSaver();
}
