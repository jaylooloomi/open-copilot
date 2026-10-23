import type { Platform } from '@oc/core';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startApp } from './startApp';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('startApp', () => {
  it('shows an error page instead of a blank page when storage cannot be opened', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const container = document.createElement('div');
    document.body.append(container);

    await startApp(container, () => Promise.reject(new Error('IndexedDB disabled')));

    expect((await screen.findByRole('alert')).textContent).toContain('無法開啟筆記儲存空間');
    expect(consoleError).toHaveBeenCalledWith('Failed to open note storage', expect.any(Error));
  });

  it('renders the notes app once the platform is ready', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const storage = {
      list: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const platform: Platform = {
      storage,
      fileSaver: { save: vi.fn(async () => undefined) },
      canPrint: true,
    };

    await startApp(container, async () => platform);

    expect(await screen.findByRole('textbox', { name: '標題' })).toBeTruthy();
  });
});
