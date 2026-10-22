import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createApiClient } from '../api/apiClient';
import { isValidBaseUrl, normalizeSettings, type Settings } from '../settings/settingsStore';

export const SETTINGS_MESSAGES = {
  testing: '測試中…',
  ok: '連線成功',
  failed: '連線失敗，請確認後端網址',
  invalidUrl: '請輸入 http:// 或 https:// 開頭的網址',
} as const;

export interface SettingsDialogProps {
  settings: Settings;
  /** Receives normalised settings; the parent saves them and closes the dialog. */
  onSave(next: Settings): void;
  onClose(): void;
  /** GET {baseUrl}/health by default; injectable for tests. */
  checkHealth?: (baseUrl: string) => Promise<boolean>;
}

const defaultCheckHealth = (baseUrl: string) => createApiClient({ baseUrl, accessKey: '' }).health();

/** 設定: backend URL, access key and a 測試連線 button. Render it only while it is open. */
export function SettingsDialog({
  settings,
  onSave,
  onClose,
  checkHealth = defaultCheckHealth,
}: SettingsDialogProps) {
  const [apiBaseUrl, setApiBaseUrl] = useState(settings.apiBaseUrl);
  const [accessKey, setAccessKey] = useState(settings.accessKey);
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  /** Bumped whenever a pending connection test should be ignored. */
  const testRequest = useRef(0);
  const titleId = useId();
  const urlId = useId();
  const keyId = useId();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    urlRef.current?.focus();
    return () => {
      testRequest.current += 1;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  /** Drops any pending test result and the old message: they describe settings that no longer apply. */
  const invalidateTest = () => {
    testRequest.current += 1;
    setTesting(false);
    setMessage('');
  };

  const testConnection = async () => {
    const { apiBaseUrl: url } = normalizeSettings({ apiBaseUrl, accessKey });
    if (!isValidBaseUrl(url)) {
      setMessage(SETTINGS_MESSAGES.invalidUrl);
      return;
    }
    const request = ++testRequest.current;
    setTesting(true);
    setMessage(SETTINGS_MESSAGES.testing);
    let ok = false;
    try {
      ok = await checkHealth(url);
    } catch {
      ok = false;
    } finally {
      if (request === testRequest.current) {
        setTesting(false);
        setMessage(ok ? SETTINGS_MESSAGES.ok : SETTINGS_MESSAGES.failed);
      }
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = normalizeSettings({ apiBaseUrl, accessKey });
    if (next.apiBaseUrl !== '' && !isValidBaseUrl(next.apiBaseUrl)) {
      setMessage(SETTINGS_MESSAGES.invalidUrl);
      urlRef.current?.focus();
      return;
    }
    onSave(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'Tab' && dialogRef.current) {
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>('input, button, select, textarea, [tabindex]'),
      ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex >= 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div
      className="oc-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="oc-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="oc-dialog-title">
          設定
        </h2>
        <form className="oc-dialog-form" noValidate onSubmit={submit}>
          <label htmlFor={urlId}>後端網址</label>
          <input
            ref={urlRef}
            id={urlId}
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://api.example.com"
            value={apiBaseUrl}
            onChange={(event) => {
              setApiBaseUrl(event.target.value);
              invalidateTest();
            }}
          />
          <label htmlFor={keyId}>存取金鑰</label>
          <input
            id={keyId}
            type="password"
            autoComplete="off"
            value={accessKey}
            onChange={(event) => setAccessKey(event.target.value)}
          />
          <p className="oc-dialog-hint">存取金鑰只會儲存在這台裝置上。</p>
          <div className="oc-dialog-test">
            <button
              type="button"
              className="oc-action-btn"
              disabled={testing}
              onClick={() => void testConnection()}
            >
              測試連線
            </button>
            <p className="oc-dialog-message" aria-live="polite">
              {message}
            </p>
          </div>
          <div className="oc-dialog-actions">
            <button type="button" className="oc-action-btn" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="oc-primary-btn">
              儲存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
