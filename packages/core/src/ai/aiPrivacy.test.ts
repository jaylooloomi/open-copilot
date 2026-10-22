import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_PRIVACY_KEY, aiPrivacy } from './aiPrivacy';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('aiPrivacy', () => {
  it('is not acknowledged until acknowledge() is called, then remembers it', () => {
    expect(AI_PRIVACY_KEY).toBe('oc.aiPrivacyAcknowledged');
    expect(aiPrivacy.isAcknowledged()).toBe(false);
    aiPrivacy.acknowledge();
    expect(localStorage.getItem(AI_PRIVACY_KEY)).toBe('1');
    expect(aiPrivacy.isAcknowledged()).toBe(true);
  });

  it('ignores any other stored value', () => {
    localStorage.setItem(AI_PRIVACY_KEY, 'yes');
    expect(aiPrivacy.isAcknowledged()).toBe(false);
  });

  it('treats unreadable storage as not acknowledged', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(aiPrivacy.isAcknowledged()).toBe(false);
  });

  it('logs instead of throwing when storage cannot be written', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => aiPrivacy.acknowledge()).not.toThrow();
    expect(error).toHaveBeenCalledWith('Failed to remember the AI privacy notice', expect.any(Error));
  });
});
