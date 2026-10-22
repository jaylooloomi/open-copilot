import { LoaderCircle, Lock, Mic, Settings, Square } from 'lucide-react';
import type { RecorderState } from '../recording/useRecorder';

export const AI_FEATURES = ['AI 摘要', '待辦事項', 'AI 助理', 'AI 對話'] as const;

export const RECORD_LABELS: Record<RecorderState, string> = {
  idle: '錄製',
  needsSetup: '請先設定',
  recording: '停止',
  stopping: '處理中',
};

export interface ActionBarProps {
  recordState: RecorderState;
  /** 錄製 → start, 停止 → stop, 請先設定 → open the settings (decided by NotesApp). */
  onRecord(): void;
  onOpenSettings(): void;
}

function RecordIcon({ state }: { state: RecorderState }) {
  if (state === 'recording') return <Square size={16} aria-hidden="true" />;
  if (state === 'stopping') return <LoaderCircle size={18} className="oc-spin" aria-hidden="true" />;
  return <Mic size={18} aria-hidden="true" />;
}

export function ActionBar({ recordState, onRecord, onOpenSettings }: ActionBarProps) {
  return (
    <div className="oc-actionbar">
      <button
        type="button"
        className={recordState === 'recording' ? 'oc-record-btn is-recording' : 'oc-record-btn'}
        disabled={recordState === 'stopping'}
        aria-busy={recordState === 'stopping' ? true : undefined}
        onClick={onRecord}
      >
        <RecordIcon state={recordState} />
        <span>{RECORD_LABELS[recordState]}</span>
      </button>
      <div className="oc-actionbar-end">
        <div className="oc-ai-group">
          {AI_FEATURES.map((label) => (
            <button
              key={label}
              type="button"
              className="oc-ai-btn"
              disabled
              aria-disabled="true"
              title="即將推出"
            >
              <Lock size={14} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="oc-settings-btn"
          aria-label="設定"
          title="設定"
          onClick={onOpenSettings}
        >
          <Settings size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
