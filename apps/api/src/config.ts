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

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
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
  const allowedOrigins = origins.length > 0 ? origins : [...DEFAULT_ALLOWED_ORIGINS];

  const rawPort = env['PORT']?.trim();
  const port = rawPort ? Number(rawPort) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${rawPort}"`);
  }

  return { openaiApiKey, accessKeys, allowedOrigins, port };
}
