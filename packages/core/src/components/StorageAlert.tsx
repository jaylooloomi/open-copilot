import { X } from 'lucide-react';

export interface StorageAlertProps {
  message: string;
  onDismiss(): void;
}

/**
 * Tells the user a note could not be created or deleted. Render it outside <main>, which is
 * inert while the drawer is open; the CSS keeps it above the drawer, since a delete fails there.
 */
export function StorageAlert({ message, onDismiss }: StorageAlertProps) {
  return (
    <div className="oc-storage-alert" role="alert">
      <p>{message}</p>
      <button
        type="button"
        className="oc-alert-dismiss"
        aria-label="關閉錯誤訊息"
        title="關閉錯誤訊息"
        onClick={onDismiss}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
