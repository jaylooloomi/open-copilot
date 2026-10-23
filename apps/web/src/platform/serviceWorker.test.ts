import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './serviceWorker';

/** jsdom has no navigator.serviceWorker; pass a navigator that has one. */
const withServiceWorker = { serviceWorker: {} };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('registerServiceWorker', () => {
  it('registers in a browser', async () => {
    const register = vi.fn(async () => undefined);
    expect(await registerServiceWorker('web', register, withServiceWorker)).toBe(true);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it.each(['desktop', 'android'] as const)('never registers in the %s app', async (kind) => {
    const register = vi.fn(async () => undefined);
    expect(await registerServiceWorker(kind, register, withServiceWorker)).toBe(false);
    expect(register).not.toHaveBeenCalled();
  });

  it('skips browsers without service workers (and jsdom)', async () => {
    const register = vi.fn(async () => undefined);
    expect(await registerServiceWorker('web', register)).toBe(false);
    expect(register).not.toHaveBeenCalled();
  });

  it('only warns when registration fails: the app works without a service worker', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = new Error('SecurityError');
    expect(await registerServiceWorker('web', async () => Promise.reject(error), withServiceWorker)).toBe(false);
    expect(warn).toHaveBeenCalledWith('Service worker registration failed', error);
  });
});
