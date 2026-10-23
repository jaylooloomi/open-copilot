import { encodeSetupPayload, type Platform } from '@oc/core';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startApp } from './startApp';

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

function fakePlatform(): Platform {
  const storage = {
    list: vi.fn(async () => []),
    get: vi.fn(async () => undefined),
    put: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
  return {
    storage,
    fileSaver: { save: vi.fn(async () => undefined) },
    canPrint: true,
  };
}

function mount(): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  return container;
}

describe('startApp', () => {
  it('shows an error page instead of a blank page when storage cannot be opened', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await startApp(mount(), () => Promise.reject(new Error('IndexedDB disabled')));

    expect((await screen.findByRole('alert')).textContent).toContain('無法開啟筆記儲存空間');
    expect(consoleError).toHaveBeenCalledWith('Failed to open note storage', expect.any(Error));
  });

  it('renders the notes app once the platform is ready', async () => {
    await startApp(mount(), async () => fakePlatform());

    expect(await screen.findByRole('textbox', { name: '標題' })).toBeTruthy();
  });

  it('applies an #oc-setup link before the app reads its settings, then drops the hash', async () => {
    const container = mount();
    const encoded = encodeSetupPayload({
      apiBaseUrl: `${window.location.origin}/api`,
      accessKey: 'prototype-key-0123',
    });
    window.history.replaceState(null, '', `/#oc-setup=${encoded}`);

    await startApp(container, async () => fakePlatform());

    expect(window.location.hash).toBe('');
    expect(JSON.parse(localStorage.getItem('oc.settings') ?? 'null')).toEqual({
      apiBaseUrl: `${window.location.origin}/api`,
      accessKey: 'prototype-key-0123',
    });
    // Configured from the first render: the record button says 錄製, not 請先設定.
    await waitFor(() =>
      expect(container.querySelector('.oc-record-btn')?.textContent).toBe('錄製'),
    );
  });

  it('ignores an invalid #oc-setup link with a warning, drops the hash and still renders', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const container = mount();
    window.history.replaceState(null, '', '/#oc-setup=not-valid');

    await startApp(container, async () => fakePlatform());

    expect(window.location.hash).toBe('');
    expect(localStorage.getItem('oc.settings')).toBeNull();
    expect(consoleWarn).toHaveBeenCalledWith('Ignored an invalid #oc-setup link');
    await waitFor(() =>
      expect(container.querySelector('.oc-record-btn')?.textContent).toBe('請先設定'),
    );
  });
});
