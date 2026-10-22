import { GROQ_DEFAULT_LLM_MODEL } from './ai/groqAssistant';
import type { AiConfig } from './ai/types';
import type { TranscribeProvider, TranscriberConfig } from './transcriber/createTranscriber';
import { GROQ_DEFAULT_TRANSCRIBE_MODEL } from './transcriber/groqTranscriber';
import { TRANSCRIBE_MODEL } from './transcriber/openaiTranscriber';

export interface AppConfig {
  transcriber: TranscriberConfig;
  /** AI 摘要／待辦事項（Groq LLM）；沒有 GROQ_API_KEY 時為 null，/ai/* 回 503 ai_unavailable。 */
  ai: AiConfig | null;
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

/** 逗號分隔、去空白、略過空項，並去除重複（保留第一次出現的順序）。 */
function splitList(value: string | undefined): string[] {
  const items = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return [...new Set(items)];
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

/** 去空白後的值；空字串或只有空白視為未設定（Docker --env-file 的 `NAME=` 會給空字串）。 */
function readValue(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/**
 * 轉寫服務：TRANSCRIBE_PROVIDER 未設定時，有 GROQ_API_KEY 就用 groq，否則有 OPENAI_API_KEY 就用 openai，
 * 兩者都沒有就拒絕啟動。錯誤訊息只列變數名稱，不含金鑰。
 */
function loadTranscriberConfig(env: Record<string, string | undefined>): TranscriberConfig {
  const groqKey = readValue(env, 'GROQ_API_KEY');
  const openaiKey = readValue(env, 'OPENAI_API_KEY');
  const rawProvider = readValue(env, 'TRANSCRIBE_PROVIDER');

  let provider: TranscribeProvider;
  if (rawProvider === undefined) {
    if (groqKey) provider = 'groq';
    else if (openaiKey) provider = 'openai';
    else {
      throw new Error(
        'No transcription API key: set GROQ_API_KEY (free key at https://console.groq.com/keys) or OPENAI_API_KEY',
      );
    }
  } else {
    const normalized = rawProvider.toLowerCase();
    if (normalized !== 'groq' && normalized !== 'openai') {
      // 若誤把金鑰貼進 TRANSCRIBE_PROVIDER，不要讓它出現在啟動日誌裡。
      const looksLikeKey = rawProvider.length > 16 || /^(gsk_|sk-)/i.test(rawProvider);
      const shown = looksLikeKey ? 'an unrecognized value (not shown)' : `"${rawProvider}"`;
      throw new Error(`TRANSCRIBE_PROVIDER must be "groq" or "openai", got ${shown}`);
    }
    provider = normalized;
  }

  if (provider === 'groq') {
    if (!groqKey) throw new Error('GROQ_API_KEY is required when TRANSCRIBE_PROVIDER=groq');
    return {
      provider,
      apiKey: groqKey,
      model: readValue(env, 'GROQ_TRANSCRIBE_MODEL') ?? GROQ_DEFAULT_TRANSCRIBE_MODEL,
    };
  }

  if (!openaiKey) throw new Error('OPENAI_API_KEY is required when TRANSCRIBE_PROVIDER=openai');
  return { provider, apiKey: openaiKey, model: TRANSCRIBE_MODEL };
}

/**
 * AI 一律走 Groq，與 TRANSCRIBE_PROVIDER 無關：有 GROQ_API_KEY 就啟用，模型預設 openai/gpt-oss-120b，
 * 可用 GROQ_LLM_MODEL 覆寫。沒有 Groq 金鑰時回 null，伺服器照常啟動，只是 /ai/* 回 503。
 */
function loadAiConfig(env: Record<string, string | undefined>): AiConfig | null {
  const groqKey = readValue(env, 'GROQ_API_KEY');
  if (!groqKey) return null;
  return { apiKey: groqKey, model: readValue(env, 'GROQ_LLM_MODEL') ?? GROQ_DEFAULT_LLM_MODEL };
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const transcriber = loadTranscriberConfig(env);
  const ai = loadAiConfig(env);

  const accessKeys = splitList(env['ACCESS_KEYS']);
  if (accessKeys.length === 0) {
    throw new Error('ACCESS_KEYS is required (comma-separated list of access keys)');
  }
  // auth 只接受不含空白的 Bearer token，含空白的金鑰啟動後永遠驗證不過，所以啟動時就擋下（訊息不含金鑰本身）。
  accessKeys.forEach((key, index) => {
    if (/\s/.test(key)) {
      throw new Error(
        `ACCESS_KEYS entry ${index + 1} contains whitespace; access keys must not contain spaces`,
      );
    }
  });

  const origins = splitList(env['ALLOWED_ORIGINS']);
  origins.forEach(assertOrigin);
  const allowedOrigins = origins.length > 0 ? origins : [...DEFAULT_ALLOWED_ORIGINS];

  const rawPort = env['PORT']?.trim();
  const port = rawPort ? parsePort(rawPort) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${rawPort}"`);
  }

  return { transcriber, ai, accessKeys, allowedOrigins, port };
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
