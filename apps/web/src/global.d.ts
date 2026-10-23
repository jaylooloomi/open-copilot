/// <reference types="vite-plugin-pwa/vanillajs" />
import type { OcDesktopBridge } from './platform/desktopFileSaver';

declare global {
  interface Window {
    /** Exposed by apps/desktop/src/preload.ts; undefined in browsers and in Capacitor. */
    ocDesktop?: OcDesktopBridge;
  }
}
