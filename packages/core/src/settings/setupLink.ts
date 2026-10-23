import { isValidBaseUrl, normalizeSettings, saveSettings, type Settings } from './settingsStore';

/** `#oc-setup=<base64url(JSON)>`，由 `npm run prototype`（之後也包含 M9 的分享網址）產生。 */
export const SETUP_HASH_PARAM = 'oc-setup';
/** 存取金鑰長度上限；正常的金鑰是 16–64 字。 */
export const MAX_SETUP_KEY_LENGTH = 512;
/** 編碼後的長度上限，擋掉離譜的網址。 */
export const MAX_SETUP_PAYLOAD_LENGTH = 4096;

export type SetupLinkResult = 'none' | 'applied' | 'invalid';

/** `{ apiBaseUrl, accessKey }` → 無 padding 的 base64url（與 Node 的 Buffer `base64url` 相同）。 */
export function encodeSetupPayload(settings: Settings): string {
  const json = JSON.stringify({ apiBaseUrl: settings.apiBaseUrl, accessKey: settings.accessKey });
  let binary = '';
  for (const byte of new TextEncoder().encode(json)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 解出並驗證設定；任何不合法（格式、網址、金鑰）都回 null，不丟錯。 */
export function decodeSetupPayload(encoded: string): Settings | null {
  if (encoded.length > MAX_SETUP_PAYLOAD_LENGTH || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const { apiBaseUrl, accessKey } = parsed as Record<string, unknown>;
    if (typeof apiBaseUrl !== 'string' || typeof accessKey !== 'string') return null;
    const settings = normalizeSettings({ apiBaseUrl, accessKey });
    if (!isValidBaseUrl(settings.apiBaseUrl)) return null;
    if (
      settings.accessKey === '' ||
      /\s/.test(settings.accessKey) ||
      settings.accessKey.length > MAX_SETUP_KEY_LENGTH
    ) {
      return null;
    }
    return settings;
  } catch {
    return null;
  }
}

/** 網址 hash 裡 `oc-setup` 的值；沒有就回 null。 */
function readSetupParam(hash: string): string | null {
  if (!hash.startsWith('#')) return null;
  return new URLSearchParams(hash.slice(1)).get(SETUP_HASH_PARAM);
}

/**
 * App 啟動時呼叫（在讀取設定之前）：hash 有 `oc-setup` 就驗證，合法才存進設定；
 * 不論合不合法都立刻用 history.replaceState 把 hash 移除，因為裡面可能有存取金鑰。
 */
export function applySetupLink(
  win: Pick<Window, 'location' | 'history'> = window,
): SetupLinkResult {
  const encoded = readSetupParam(win.location.hash);
  if (encoded === null) return 'none';
  const settings = decodeSetupPayload(encoded);
  if (settings) saveSettings(settings);
  win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search);
  return settings ? 'applied' : 'invalid';
}
