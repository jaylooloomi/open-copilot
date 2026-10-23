import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSettings, saveSettings } from './settingsStore';
import {
  applySetupLink,
  decodeSetupPayload,
  encodeSetupPayload,
  MAX_SETUP_KEY_LENGTH,
  MAX_SETUP_PAYLOAD_LENGTH,
  SETUP_HASH_PARAM,
} from './setupLink';

/** Same bytes as Node's Buffer.from(text).toString('base64url'), which the prototype launcher uses. */
function toBase64Url(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Same origin as the page (jsdom serves http://localhost:3000), like every planned producer. */
const API = `${window.location.origin}/api`;

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('encodeSetupPayload / decodeSetupPayload', () => {
  it('round-trips the backend URL and access key as unpadded base64url', () => {
    const encoded = encodeSetupPayload({ apiBaseUrl: API, accessKey: 'k_-~.0123456789abcdef' });
    expect(SETUP_HASH_PARAM).toBe('oc-setup');
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSetupPayload(encoded)).toEqual({ apiBaseUrl: API, accessKey: 'k_-~.0123456789abcdef' });
  });

  it('decodes what the launcher writes and normalises it like the settings dialog', () => {
    const encoded = toBase64Url(
      JSON.stringify({ apiBaseUrl: ' https://notes.example.com/api/ ', accessKey: ' key-1 ' }),
    );
    expect(decodeSetupPayload(encoded)).toEqual({
      apiBaseUrl: 'https://notes.example.com/api',
      accessKey: 'key-1',
    });
  });

  it.each([
    ['characters outside base64url', '!!!'],
    ['text that is not JSON', toBase64Url('{oops')],
    ['an array', toBase64Url('[]')],
    ['a missing access key', toBase64Url(JSON.stringify({ apiBaseUrl: API }))],
    ['a URL that is not http(s)', toBase64Url(JSON.stringify({ apiBaseUrl: 'javascript:alert(1)', accessKey: 'k' }))],
    ['a blank access key', toBase64Url(JSON.stringify({ apiBaseUrl: API, accessKey: '   ' }))],
    ['an access key with a space', toBase64Url(JSON.stringify({ apiBaseUrl: API, accessKey: 'a b' }))],
    [
      'an access key that is too long',
      toBase64Url(JSON.stringify({ apiBaseUrl: API, accessKey: 'k'.repeat(MAX_SETUP_KEY_LENGTH + 1) })),
    ],
    ['bytes that are not UTF-8', '__4'],
    ['an empty payload', ''],
    ['an over-long payload', 'A'.repeat(MAX_SETUP_PAYLOAD_LENGTH + 1)],
  ])('rejects %s', (_label, encoded) => {
    expect(decodeSetupPayload(encoded)).toBeNull();
  });
});

describe('applySetupLink', () => {
  it('saves valid settings and removes the hash, keeping the path and query', () => {
    saveSettings({ apiBaseUrl: 'https://old.example.com', accessKey: 'old-key' });
    const encoded = encodeSetupPayload({ apiBaseUrl: API, accessKey: 'prototype-key-0123' });
    window.history.replaceState(null, '', `/notes?view=1#${SETUP_HASH_PARAM}=${encoded}`);

    expect(applySetupLink(window)).toBe('applied');

    expect(loadSettings()).toEqual({ apiBaseUrl: API, accessKey: 'prototype-key-0123' });
    expect(window.location.hash).toBe('');
    expect(window.location.pathname + window.location.search).toBe('/notes?view=1');
  });

  it('keeps the old settings but still removes the hash when the payload is invalid', () => {
    saveSettings({ apiBaseUrl: 'https://old.example.com', accessKey: 'old-key' });
    window.history.replaceState(null, '', `/#${SETUP_HASH_PARAM}=not-a-valid-payload`);

    expect(applySetupLink(window)).toBe('invalid');

    expect(loadSettings()).toEqual({ apiBaseUrl: 'https://old.example.com', accessKey: 'old-key' });
    expect(window.location.hash).toBe('');
  });

  it('treats an empty oc-setup value as invalid and removes the hash', () => {
    window.history.replaceState(null, '', `/#${SETUP_HASH_PARAM}=`);

    expect(applySetupLink(window)).toBe('invalid');

    expect(window.location.hash).toBe('');
    expect(localStorage.getItem('oc.settings')).toBeNull();
  });

  it('reports invalid, keeps the old settings and removes the hash when saving fails', () => {
    saveSettings({ apiBaseUrl: 'https://old.example.com', accessKey: 'old-key' });
    const encoded = encodeSetupPayload({ apiBaseUrl: API, accessKey: 'prototype-key-0123' });
    window.history.replaceState(null, '', `/#${SETUP_HASH_PARAM}=${encoded}`);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    expect(applySetupLink(window)).toBe('invalid');

    expect(loadSettings()).toEqual({ apiBaseUrl: 'https://old.example.com', accessKey: 'old-key' });
    expect(window.location.hash).toBe('');
  });

  it.each([
    ['another host', 'https://attacker.example/api'],
    ['another port on the same host', 'http://localhost:8787'],
    ['another scheme', window.location.origin.replace(/^http:/, 'https:') + '/api'],
  ])('refuses a backend on %s: keeps the old settings and removes the hash', (_label, apiBaseUrl) => {
    saveSettings({ apiBaseUrl: 'https://old.example.com', accessKey: 'old-key' });
    const encoded = encodeSetupPayload({ apiBaseUrl, accessKey: 'attacker-key-0123' });
    window.history.replaceState(null, '', `/#${SETUP_HASH_PARAM}=${encoded}`);

    expect(applySetupLink(window)).toBe('invalid');

    expect(loadSettings()).toEqual({ apiBaseUrl: 'https://old.example.com', accessKey: 'old-key' });
    expect(window.location.hash).toBe('');
  });

  it('leaves other hashes alone', () => {
    window.history.replaceState(null, '', '/#section-2');

    expect(applySetupLink(window)).toBe('none');

    expect(window.location.hash).toBe('#section-2');
    expect(localStorage.getItem('oc.settings')).toBeNull();
  });
});
