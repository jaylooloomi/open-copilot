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
  const titleId = useId();
  const urlId = useId();
  const keyId = useId();

  useEffect(() => {
    urlRef.current?.focus();
  }, []);

  const testConnection = async () => {
    const { apiBaseUrl: url } = normalizeSettings({ apiBaseUrl, accessKey });
    if (!isValidBaseUrl(url)) {
      setMessage(SETTINGS_MESSAGES.invalidUrl);
      return;
    }
    setTesting(true);
    setMessage(SETTINGS_MESSAGES.testing);
    const ok = await checkHealth(url);
    setTesting(false);
    setMessage(ok ? SETTINGS_MESSAGES.ok : SETTINGS_MESSAGES.failed);
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
            onChange={(event) => setApiBaseUrl(event.target.value)}
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
