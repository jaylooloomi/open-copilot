export interface AppConfig {
  openaiApiKey: string;
  accessKeys: string[];
  allowedOrigins: string[];
  port: number;
}

export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  'http://localhost:5173',
  'https://localhost',
  'capacitor://localhost',
  'app://bundle',
];

export const DEFAULT_PORT = 8787;

/** 短於這個長度的存取金鑰只發警告、不拒絕啟動（各里程碑的人工檢查用 dev-key）。 */
export const MIN_ACCESS_KEY_LENGTH = 16;

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * hono cors 以字串完全比對瀏覽器的 Origin（永遠是小寫、無路徑、無尾斜線）。
 * 像 https://notes.example.com/ 這種值永遠比對不到，CORS 會默默失敗，所以啟動時就擋下。
 */
function assertOrigin(entry: string): void {
  let url: URL | undefined;
  try {
    url = new URL(entry);
  } catch {
    url = undefined;
  }
  if (!url || url.host === '') {
    throw new Error(
      `ALLOWED_ORIGINS entry "${entry}" is not an origin (expected scheme://host[:port])`,
    );
  }
  // http(s) 用 URL 標準的 origin；capacitor://、app:// 這類自訂 scheme 的 origin 是 "null"，改用 scheme://host。
  const origin =
    url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : `${url.protocol}//${url.host}`;
  if (origin !== entry) {
    throw new Error(
      `ALLOWED_ORIGINS entry "${entry}" is not an origin; use "${origin}" (scheme://host[:port], no path or trailing slash)`,
    );
  }
}

// Only plain decimal digits; Number() alone would also accept '0x1F90', '1e3' and '3000.0'.
function parsePort(raw: string): number {
  return /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const openaiApiKey = env['OPENAI_API_KEY']?.trim();
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY is required');
  }

  const accessKeys = splitList(env['ACCESS_KEYS']);
  if (accessKeys.length === 0) {
    throw new Error('ACCESS_KEYS is required (comma-separated list of access keys)');
  }

  const origins = splitList(env['ALLOWED_ORIGINS']);
  origins.forEach(assertOrigin);
  const allowedOrigins = origins.length > 0 ? origins : [...DEFAULT_ALLOWED_ORIGINS];

  const rawPort = env['PORT']?.trim();
  const port = rawPort ? parsePort(rawPort) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${rawPort}"`);
  }

  return { openaiApiKey, accessKeys, allowedOrigins, port };
}

/**
 * 錯誤金鑰的嘗試不計入限流：限流依「已通過驗證」的金鑰計數，而依 IP 限制在反向代理後會讓所有人共用一個桶。
 * 所以金鑰本身必須夠長、夠隨機。回傳啟動時要印出的警告；訊息不含金鑰本身。
 */
export function accessKeyWarning(accessKeys: readonly string[]): string | undefined {
  const short = accessKeys.filter((key) => key.length < MIN_ACCESS_KEY_LENGTH).length;
  if (short === 0) return undefined;
  return (
    `[config] ${short} of ${accessKeys.length} ACCESS_KEYS ${short === 1 ? 'is' : 'are'} ` +
    `shorter than ${MIN_ACCESS_KEY_LENGTH} characters. ` +
    'Wrong-key attempts are not rate-limited, so short keys can be guessed online; ' +
    'use long random keys, e.g. node -e "console.log(crypto.randomUUID())"'
  );
}
