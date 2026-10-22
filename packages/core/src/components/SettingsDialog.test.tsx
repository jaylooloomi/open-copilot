import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../settings/settingsStore';
import { SettingsDialog } from './SettingsDialog';

function setup(settings: Settings = { apiBaseUrl: '', accessKey: '' }, checkHealth = vi.fn(async (_url: string) => true)) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(<SettingsDialog settings={settings} onSave={onSave} onClose={onClose} checkHealth={checkHealth} />);
  return {
    onSave,
    onClose,
    checkHealth,
    user: userEvent.setup(),
    url: screen.getByLabelText('後端網址'),
    key: screen.getByLabelText('存取金鑰'),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SettingsDialog', () => {
  it('shows the current settings in a modal dialog titled 設定', () => {
    const { url, key } = setup({ apiBaseUrl: 'https://api.test', accessKey: 'k1' });
    const dialog = screen.getByRole('dialog', { name: '設定' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(url).toHaveValue('https://api.test');
    expect(url).toHaveFocus();
    expect(key).toHaveValue('k1');
    expect(key).toHaveAttribute('type', 'password');
  });

  it('saves trimmed settings without a trailing slash', async () => {
    const { user, url, key, onSave } = setup();
    await user.type(url, ' https://api.test/ ');
    await user.type(key, ' secret ');
    await user.click(screen.getByRole('button', { name: '儲存' }));
    expect(onSave).toHaveBeenCalledWith({ apiBaseUrl: 'https://api.test', accessKey: 'secret' });
  });

  it('refuses a URL that is not http or https', async () => {
    const { user, url, onSave } = setup();
    await user.type(url, 'api.test');
    await user.click(screen.getByRole('button', { name: '儲存' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('請輸入 http:// 或 https:// 開頭的網址')).toBeInTheDocument();
  });

  it('allows clearing the settings', async () => {
    const { user, url, key, onSave } = setup({ apiBaseUrl: 'https://api.test', accessKey: 'k1' });
    await user.clear(url);
    await user.clear(key);
    await user.click(screen.getByRole('button', { name: '儲存' }));
    expect(onSave).toHaveBeenCalledWith({ apiBaseUrl: '', accessKey: '' });
  });

  it('tests the connection with the URL being edited', async () => {
    let answer: (ok: boolean) => void = () => undefined;
    const checkHealth = vi.fn((_url: string) => new Promise<boolean>((resolve) => (answer = resolve)));
    const { user, url } = setup({ apiBaseUrl: '', accessKey: '' }, checkHealth);
    await user.type(url, 'http://localhost:8787/');
    await user.click(screen.getByRole('button', { name: '測試連線' }));

    expect(checkHealth).toHaveBeenCalledWith('http://localhost:8787');
    expect(screen.getByText('測試中…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '測試連線' })).toBeDisabled();

    answer(true);
    expect(await screen.findByText('連線成功')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '測試連線' })).toBeEnabled();
  });

  it('reports a failed connection test and an unusable URL', async () => {
    const checkHealth = vi.fn(async (_url: string) => false);
    const { user, url } = setup({ apiBaseUrl: 'https://down.test', accessKey: '' }, checkHealth);
    await user.click(screen.getByRole('button', { name: '測試連線' }));
    expect(await screen.findByText('連線失敗，請確認後端網址')).toBeInTheDocument();

    await user.clear(url);
    await user.click(screen.getByRole('button', { name: '測試連線' }));
    expect(screen.getByText('請輸入 http:// 或 https:// 開頭的網址')).toBeInTheDocument();
    expect(checkHealth).toHaveBeenCalledTimes(1);
  });

  it('calls GET <url>/health when no checkHealth is given', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <SettingsDialog
        settings={{ apiBaseUrl: 'https://api.test', accessKey: '' }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: '測試連線' }));
    expect(await screen.findByText('連線成功')).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.test/health');
  });

  it('closes on 取消 and on Escape without saving', async () => {
    const { user, onClose, onSave } = setup();
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
  });
});
