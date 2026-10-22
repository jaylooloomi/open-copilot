import * as path from 'node:path';

export const APP_SCHEME = 'app';
export const APP_HOST = 'bundle';
/** The renderer's origin; the backend's CORS list (M3a ALLOWED_ORIGINS) contains it. */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

/** Characters no file in the web build uses; rejecting them blocks `\..\`, drive letters and NUL. */
const FORBIDDEN = /[\\:\0]/;

/**
 * Maps an app://bundle/... request to a file inside `rootDir`, or null when the URL is not ours,
 * is malformed, or would escape `rootDir`. Query strings and fragments are ignored.
 */
export function resolveAppPath(requestUrl: string, rootDir: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null; // malformed percent-encoding
  }
  if (pathname === '' || pathname === '/') pathname = '/index.html';
  if (FORBIDDEN.test(pathname)) return null;

  const root = path.resolve(rootDir);
  const filePath = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, filePath);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  return filePath;
}

/** True for pages served by our own protocol (used to trust IPC senders and permission requests). */
export function isAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST;
  } catch {
    return false;
  }
}
