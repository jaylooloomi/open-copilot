import { afterEach, describe, expect, it, vi } from 'vitest';
import { extensionFor, MIME_TYPE_CANDIDATES, pickMimeType } from './pickMimeType';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pickMimeType', () => {
  it('tries webm/opus first, then mp4', () => {
    expect(MIME_TYPE_CANDIDATES).toEqual(['audio/webm;codecs=opus', 'audio/mp4']);
    expect(pickMimeType(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickMimeType((type) => type === 'audio/mp4')).toBe('audio/mp4');
  });

  it('returns undefined when no candidate is supported', () => {
    expect(pickMimeType(() => false)).toBeUndefined();
  });

  it('asks MediaRecorder.isTypeSupported by default', () => {
    const isTypeSupported = vi.fn((type: string) => type === 'audio/mp4');
    vi.stubGlobal('MediaRecorder', { isTypeSupported });
    expect(pickMimeType()).toBe('audio/mp4');
    expect(isTypeSupported).toHaveBeenCalledWith('audio/webm;codecs=opus');
  });

  it('returns undefined when MediaRecorder does not exist (jsdom)', () => {
    expect(typeof MediaRecorder).toBe('undefined');
    expect(pickMimeType()).toBeUndefined();
  });
});

describe('extensionFor', () => {
  it('maps mp4 audio to mp4 and everything else to webm', () => {
    expect(extensionFor('audio/mp4')).toBe('mp4');
    expect(extensionFor('audio/mp4;codecs=mp4a.40.2')).toBe('mp4');
    expect(extensionFor('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionFor('')).toBe('webm');
  });
});
