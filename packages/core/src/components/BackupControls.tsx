import { Download, Upload } from 'lucide-react';
import { useRef, type ChangeEvent } from 'react';

/** What the file picker offers: backup files are JSON. */
export const BACKUP_FILE_ACCEPT = 'application/json,.json';

export interface BackupControlsProps {
  /** While recording, or while a backup or import is running. */
  disabled: boolean;
  /** Result of the last backup or import; nothing is shown while undefined. */
  message: string | undefined;
  onBackup(): void;
  onImportFile(file: File): void;
}

/** The 備份 and 匯入 buttons at the bottom of the note list. */
export function BackupControls({ disabled, message, onBackup, onImportFile }: BackupControlsProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so that choosing the same file again still fires change.
    event.target.value = '';
    if (file) onImportFile(file);
  };

  return (
    <div className="oc-backup">
      <div className="oc-backup-buttons">
        <button type="button" className="oc-backup-btn" disabled={disabled} onClick={onBackup}>
          <Download size={16} aria-hidden="true" />
          備份
        </button>
        <button
          type="button"
          className="oc-backup-btn"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={16} aria-hidden="true" />
          匯入
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={BACKUP_FILE_ACCEPT}
        aria-label="選擇備份檔"
        tabIndex={-1}
        hidden
        onChange={onChange}
      />
      {message && (
        <p className="oc-backup-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
