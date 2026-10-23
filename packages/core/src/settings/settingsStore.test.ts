import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_SETTINGS,
  isConfigured,
  isValidBaseUrl,
  loadSettings,
  normalizeSettings,
  saveSettings,
  SETTINGS_KEY,
} from './settingsStore';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('loadSettings', () => {
  it('returns empty settings when nothing is stored', () => {
    expect(SETTINGS_KEY).toBe('oc.settings');
    expect(loadSettings()).toEqual(EMPTY_SETTINGS);
    expect(EMPTY_SETTINGS).toEqual({ apiBaseUrl: '', accessKey: '' });
  });

  it('reads what saveSettings wrote, trimmed and without a trailing slash', () => {
    saveSettings({ apiBaseUrl: ' https://api.example.com/ ', accessKey: ' key-1 ' });
    expect(JSON.parse(localStorage.getItem('oc.settings') ?? '')).toEqual({
      apiBaseUrl: 'https://api.example.com',
      accessKey: 'key-1',
    });
    expect(loadSettings()).toEqual({ apiBaseUrl: 'https://api.example.com', accessKey: 'key-1' });
  });

  it('normalises values that were stored without saveSettings', () => {
    localStorage.setItem('oc.settings', JSON.stringify({ apiBaseUrl: ' https://a.test/ ', accessKey: ' k ' }));
    expect(loadSettings()).toEqual({ apiBaseUrl: 'https://a.test', accessKey: 'k' });
  });

  it('ignores broken or partial JSON', () => {
    localStorage.setItem('oc.settings', '{not json');
    expect(loadSettings()).toEqual(EMPTY_SETTINGS);
    localStorage.setItem('oc.settings', JSON.stringify({ apiBaseUrl: 'https://a.test', accessKey: 42 }));
    expect(loadSettings()).toEqual({ apiBaseUrl: 'https://a.test', accessKey: '' });
    localStorage.setItem('oc.settings', 'null');
    expect(loadSettings()).toEqual(EMPTY_SETTINGS);
  });
});

describe('saveSettings', () => {
  it('does not throw when storage is unavailable', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => saveSettings({ apiBaseUrl: 'https://a.test', accessKey: 'k' })).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('normalizeSettings', () => {
  it('trims both fields and drops trailing slashes from the URL', () => {
    expect(normalizeSettings({ apiBaseUrl: ' http://localhost:8787// ', accessKey: '\tk\n' })).toEqual({
      apiBaseUrl: 'http://localhost:8787',
      accessKey: 'k',
    });
  });
});

describe('isConfigured', () => {
  it('needs both a backend URL and an access key', () => {
    expect(isConfigured({ apiBaseUrl: 'https://a.test', accessKey: 'k' })).toBe(true);
    expect(isConfigured({ apiBaseUrl: 'https://a.test', accessKey: ' ' })).toBe(false);
    expect(isConfigured({ apiBaseUrl: '', accessKey: 'k' })).toBe(false);
  });
});

describe('isValidBaseUrl', () => {
  it('accepts only http and https URLs', () => {
    expect(isValidBaseUrl('https://api.example.com')).toBe(true);
    expect(isValidBaseUrl('http://localhost:8787')).toBe(true);
    expect(isValidBaseUrl('ftp://a.test')).toBe(false);
    expect(isValidBaseUrl('api.example.com')).toBe(false);
    expect(isValidBaseUrl('')).toBe(false);
  });
});
