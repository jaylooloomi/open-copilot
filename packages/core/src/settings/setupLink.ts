import {
  isValidBaseUrl,
  loadSettings,
  normalizeSettings,
  saveSettings,
  type Settings,
} from './settingsStore';

/** `#oc-setup=<base64url(JSON)>`，由 `npm run prototype`（之後也包含 M9 的分享網址）產生。 */
export const SETUP_HASH_PARAM = 'oc-setup';
/** 存取金鑰長度上限；正常的金鑰是 16–64 字。 */
export const MAX_SETUP_KEY_LENGTH = 512;
/** 編碼後的長度上限，擋掉離譜的網址。 */
export const MAX_SETUP_PAYLOAD_LENGTH = 4096;

export type SetupLinkResult = 'none' | 'applied' | 'invalid';

/** 連結要取代另一把已存的存取金鑰時，先問使用者（不顯示任何金鑰）。 */
export const SETUP_REPLACE_CONFIRM =
  '這個連結會把後端網址與存取金鑰換成新的值，取代目前的設定。' +
  '只有在開啟自己的 npm run prototype 印出的網址時才按「確定」。要取代嗎？';

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

/** 沒存金鑰、或連結帶的就是目前的設定時不必問；否則要使用者按「確定」。 */
function mayReplace(
  current: Settings,
  next: Settings,
  win: Partial<Pick<Window, 'confirm'>>,
): boolean {
  if (current.accessKey === '') return true;
  if (current.accessKey === next.accessKey && current.apiBaseUrl === next.apiBaseUrl) return true;
  try {
    return win.confirm?.(SETUP_REPLACE_CONFIRM) === true;
  } catch {
    return false;
  }
}

function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/**
 * App 啟動時呼叫（在讀取設定之前）：hash 有 `oc-setup` 就驗證，合法才存進設定；
 * 不論合不合法都立刻用 history.replaceState 把 hash 移除，因為裡面可能有存取金鑰。
 * 存檔失敗（例如 localStorage 已滿或被封鎖）也回 'invalid'，舊設定維持不變。
 * 後端網址必須和目前頁面同源（prototype 用 `<網頁>/api`、M9 用 `<tunnel>/api`）：別人做的連結
 * 若指向其他網站，會把之後的錄音和金鑰送過去，所以一律當成 'invalid'，不覆蓋設定。
 * 已經存了另一把存取金鑰時，先用 `win.confirm` 問過才覆蓋（任何網頁都能把人導到這個連結，
 * 不問就會默默換掉金鑰）；使用者不同意、或 `win` 沒有 confirm，也回 'invalid'，舊設定不變。
 */
export function applySetupLink(
  win: Pick<Window, 'location' | 'history'> & Partial<Pick<Window, 'confirm'>> = window,
): SetupLinkResult {
  const encoded = readSetupParam(win.location.hash);
  if (encoded === null) return 'none';
  const settings = decodeSetupPayload(encoded);
  let saved = false;
  if (
    settings &&
    isSameOrigin(settings.apiBaseUrl, win.location.origin) &&
    mayReplace(loadSettings(), settings, win)
  ) {
    saveSettings(settings);
    const stored = loadSettings();
    saved = stored.apiBaseUrl === settings.apiBaseUrl && stored.accessKey === settings.accessKey;
  }
  win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search);
  return saved ? 'applied' : 'invalid';
}
