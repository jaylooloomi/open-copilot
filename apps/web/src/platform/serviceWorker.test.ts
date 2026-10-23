import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker, registerWithPwa } from './serviceWorker';

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

describe('registerWithPwa', () => {
  type Options = { immediate?: boolean; onRegisteredSW?: (url: string, r: ServiceWorkerRegistration | undefined) => void; onRegisterError?: (e: unknown) => void };

  it('resolves once vite-plugin-pwa reports the worker registered', async () => {
    const registerSW = vi.fn((options: Options) => {
      options.onRegisteredSW?.('/sw.js', undefined);
      return async () => undefined;
    });
    await expect(registerWithPwa(registerSW)).resolves.toBeUndefined();
    expect(registerSW).toHaveBeenCalledWith(expect.objectContaining({ immediate: true }));
  });

  it('rejects with the error vite-plugin-pwa reports through onRegisterError', async () => {
    const error = new Error('404 sw.js');
    const registerSW = (options: Options) => {
      options.onRegisterError?.(error);
      return async () => undefined;
    };
    await expect(registerWithPwa(registerSW)).rejects.toBe(error);
  });

  it('lets registerServiceWorker warn about a real registration failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = new Error('SecurityError');
    const registerSW = (options: Options) => {
      queueMicrotask(() => options.onRegisterError?.(error));
      return async () => undefined;
    };
    expect(await registerServiceWorker('web', () => registerWithPwa(registerSW), withServiceWorker)).toBe(false);
    expect(warn).toHaveBeenCalledWith('Service worker registration failed', error);
  });
});

describe('registerWithPwa onNeedReload', () => {
  type Options = { onNeedReload?: () => void };

  it('hands vite-plugin-pwa the reload handler, so it does not reload the page itself', async () => {
    const onNeedReload = vi.fn();
    let options: Options = {};
    void registerWithPwa((o: Options) => {
      options = o;
      return async () => undefined;
    }, onNeedReload);
    expect(options.onNeedReload).toBe(onNeedReload);
  });
});
