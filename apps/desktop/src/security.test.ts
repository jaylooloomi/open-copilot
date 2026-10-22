import { describe, expect, it } from 'vitest';
import { isExternalHttpUrl, shouldGrantPermission } from './security';

const PAGE = 'app://bundle/index.html';

describe('shouldGrantPermission', () => {
  it('grants the microphone to app://bundle pages', () => {
    expect(shouldGrantPermission('media', { requestingUrl: PAGE, mediaTypes: ['audio'] })).toBe(true);
  });

  it('denies the camera, even together with the microphone', () => {
    expect(shouldGrantPermission('media', { requestingUrl: PAGE, mediaTypes: ['video'] })).toBe(false);
    expect(
      shouldGrantPermission('media', { requestingUrl: PAGE, mediaTypes: ['audio', 'video'] }),
    ).toBe(false);
  });

  it('denies media requests that do not name the microphone', () => {
    expect(shouldGrantPermission('media', { requestingUrl: PAGE })).toBe(false);
    expect(shouldGrantPermission('media', { requestingUrl: PAGE, mediaTypes: [] })).toBe(false);
    expect(shouldGrantPermission('media', { requestingUrl: PAGE, mediaTypes: ['unknown'] })).toBe(false);
  });

  it('grants clipboard writes (複製) but not clipboard reads', () => {
    expect(shouldGrantPermission('clipboard-sanitized-write', { requestingUrl: PAGE })).toBe(true);
    expect(shouldGrantPermission('clipboard-read', { requestingUrl: PAGE })).toBe(false);
  });

  it('denies everything to pages outside app://bundle', () => {
    expect(
      shouldGrantPermission('media', { requestingUrl: 'https://example.com/', mediaTypes: ['audio'] }),
    ).toBe(false);
    expect(shouldGrantPermission('media', { mediaTypes: ['audio'] })).toBe(false);
    expect(
      shouldGrantPermission('clipboard-sanitized-write', { requestingUrl: 'https://example.com/' }),
    ).toBe(false);
  });

  it('denies every other permission', () => {
    for (const permission of ['geolocation', 'notifications', 'openExternal', 'local-network-access', 'unknown']) {
      expect(shouldGrantPermission(permission, { requestingUrl: PAGE }), permission).toBe(false);
    }
  });
});

describe('isExternalHttpUrl', () => {
  it('accepts http and https links only', () => {
    expect(isExternalHttpUrl('https://example.com/a?b=1')).toBe(true);
    expect(isExternalHttpUrl('http://localhost:8787/health')).toBe(true);
    expect(isExternalHttpUrl('app://bundle/index.html')).toBe(false);
    expect(isExternalHttpUrl('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(isExternalHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isExternalHttpUrl('not a url')).toBe(false);
  });
});
