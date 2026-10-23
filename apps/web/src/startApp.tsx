import { applySetupLink, NotesApp, PlatformProvider, type Platform } from '@oc/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Opens the platform and renders the app into `container`. If the platform cannot be opened
 * (IndexedDB blocked by a site-data policy or private mode, a corrupted database, a downgrade),
 * it renders a static error message instead of leaving a blank page.
 */
export async function startApp(
  container: HTMLElement,
  selectPlatform: () => Promise<Platform>,
): Promise<void> {
  // `npm run prototype` opens /#oc-setup=…: save those settings before NotesApp reads them, and
  // drop the hash (it carries the access key) from the address bar right away.
  applySetupLink(window);
  const root = createRoot(container);
  let platform: Platform;
  try {
    platform = await selectPlatform();
  } catch (error) {
    console.error('Failed to open note storage', error);
    root.render(
      <div className="oc-load-error" role="alert">
        <p>無法開啟筆記儲存空間。請確認瀏覽器允許本網站儲存資料（非無痕模式），再重新整理頁面。</p>
      </div>,
    );
    return;
  }
  root.render(
    <StrictMode>
      <PlatformProvider platform={platform}>
        <NotesApp />
      </PlatformProvider>
    </StrictMode>,
  );
}
