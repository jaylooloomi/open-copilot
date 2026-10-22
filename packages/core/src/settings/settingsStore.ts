export interface Settings {
  /** Backend origin, e.g. `https://api.example.com` (no trailing slash). */
  apiBaseUrl: string;
  accessKey: string;
}

export const SETTINGS_KEY = 'oc.settings';

export const EMPTY_SETTINGS: Settings = { apiBaseUrl: '', accessKey: '' };

/** Reads the settings from localStorage; missing or broken data gives empty settings. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...EMPTY_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...EMPTY_SETTINGS };
    const { apiBaseUrl, accessKey } = parsed as Record<string, unknown>;
    return {
      apiBaseUrl: typeof apiBaseUrl === 'string' ? apiBaseUrl : '',
      accessKey: typeof accessKey === 'string' ? accessKey : '',
    };
  } catch {
    return { ...EMPTY_SETTINGS };
  }
}

/** Saves normalised settings; a storage failure is logged, never thrown. */
export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
  } catch (error) {
    console.error('Failed to save settings', error);
  }
}

export function normalizeSettings(settings: Settings): Settings {
  return {
    apiBaseUrl: settings.apiBaseUrl.trim().replace(/\/+$/, ''),
    accessKey: settings.accessKey.trim(),
  };
}

/** Recording needs both a backend URL and an access key. */
export function isConfigured(settings: Settings): boolean {
  return settings.apiBaseUrl.trim() !== '' && settings.accessKey.trim() !== '';
}

export function isValidBaseUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
