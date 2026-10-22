import {
  createBrowserFileSaver,
  createIndexedDbStorage,
  openAppDb,
  type Platform,
} from '@oc/core';

/** M1: the browser platform only. M4 adds Electron, M5 adds Capacitor. */
export async function selectPlatform(): Promise<Platform> {
  const db = await openAppDb();
  return {
    storage: createIndexedDbStorage(db),
    fileSaver: createBrowserFileSaver(),
    canPrint: true,
  };
}
