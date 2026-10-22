export interface BannerProps {
  /** Show the backup reminder instead of the recording tip. */
  backupDue?: boolean;
  /** 立即備份 is disabled (recording, or a backup or import is running). */
  backupDisabled?: boolean;
  onBackup?(): void;
}

export function Banner({ backupDue = false, backupDisabled = false, onBackup }: BannerProps) {
  if (backupDue) {
    return (
      <div className="oc-banner oc-banner-backup" role="note">
        <strong>已超過 7 天沒有備份筆記</strong>
        <button type="button" className="oc-banner-action" disabled={backupDisabled} onClick={onBackup}>
          立即備份
        </button>
      </div>
    );
  }
  return (
    <div className="oc-banner" role="note">
      <strong>手動輸入累了？</strong> 按「錄製」，open-copilot 幫你把語音轉成文字，你只需要專注思考。
    </div>
  );
}
