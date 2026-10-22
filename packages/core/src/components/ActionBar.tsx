import {
  ListChecks,
  LoaderCircle,
  Lock,
  Mic,
  Settings,
  Sparkles,
  Square,
  type LucideIcon,
} from 'lucide-react';
import type { LevelSource } from '../recording/levelStore';
import type { RecorderState } from '../recording/useRecorder';
import { useId } from 'react';
import { RecordingStatus } from './RecordingStatus';

export const AI_FEATURES = ['AI 摘要', '待辦事項', 'AI 助理', 'AI 對話'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/** The AI features that work (M11); the others stay locked as 即將推出. */
const AVAILABLE_AI: Partial<Record<AiFeature, { action: 'summary' | 'todos'; Icon: LucideIcon }>> = {
  'AI 摘要': { action: 'summary', Icon: Sparkles },
  '待辦事項': { action: 'todos', Icon: ListChecks },
};

export const RECORD_LABELS: Record<RecorderState, string> = {
  idle: '錄製',
  needsSetup: '請先設定',
  recording: '停止',
  stopping: '處理中',
};

/** Handlers for the unlocked AI buttons (decided by NotesApp). */
export interface AiActions {
  summary(): void;
  todos(): void;
  /**
   * Why both buttons are unusable now, shown as their title and linked as their accessible
   * description; undefined (or empty) when they can be used.
   */
  disabledReason?: string;
}

export interface ActionBarProps {
  recordState: RecorderState;
  /** 錄製 → start, 停止 → stop, 請先設定 → open the settings (decided by NotesApp). */
  onRecord(): void;
  onOpenSettings(): void;
  /** Disables 錄製 / 請先設定, e.g. while a backup or import runs. Ignored while recording. */
  recordDisabled?: boolean;
  /** When the running recording started (useRecorder's startedAt); the timer counts from it. */
  startedAt?: number | null;
  /** Microphone level for the meter (useRecorder's levels). */
  levels?: LevelSource;
  /** 轉寫中 N 段 (useRecorder's transcribing); hidden at 0. */
  transcribing?: number;
  /** Clock for the timer: useRecorder's now, the one startedAt was read from. Defaults to Date.now. */
  now?: () => number;
  /** Unlocks AI 摘要 and 待辦事項; without it all four AI buttons are locked. */
  ai?: AiActions;
}

function RecordIcon({ state }: { state: RecorderState }) {
  if (state === 'recording') return <Square size={16} aria-hidden="true" />;
  if (state === 'stopping') return <LoaderCircle size={18} className="oc-spin" aria-hidden="true" />;
  return <Mic size={18} aria-hidden="true" />;
}

export function ActionBar({
  recordState,
  onRecord,
  onOpenSettings,
  recordDisabled = false,
  startedAt = null,
  levels,
  transcribing = 0,
  now,
  ai,
}: ActionBarProps) {
  // Stopping a running recording is always allowed.
  const disabled = recordState === 'stopping' || (recordDisabled && recordState !== 'recording');
  // An empty reason counts as no reason, so the buttons never end up disabled without one.
  const aiReason = ai?.disabledReason || undefined;
  const aiReasonId = useId();
  return (
    <div className="oc-actionbar">
      <button
        type="button"
        className={recordState === 'recording' ? 'oc-record-btn is-recording' : 'oc-record-btn'}
        disabled={disabled}
        aria-busy={recordState === 'stopping' ? true : undefined}
        onClick={onRecord}
      >
        <RecordIcon state={recordState} />
        <span>{RECORD_LABELS[recordState]}</span>
      </button>
      <RecordingStatus
        recording={recordState === 'recording'}
        startedAt={startedAt}
        levels={levels}
        transcribing={transcribing}
        now={now}
      />
      <div className="oc-actionbar-end">
        <div className="oc-ai-group">
          {AI_FEATURES.map((label) => {
            const available = AVAILABLE_AI[label];
            if (ai && available) {
              const { action, Icon } = available;
              return (
                <button
                  key={label}
                  type="button"
                  className="oc-ai-btn is-available"
                  disabled={aiReason !== undefined}
                  title={aiReason ?? label}
                  aria-describedby={aiReason !== undefined ? aiReasonId : undefined}
                  onClick={() => ai[action]()}
                >
                  <Icon size={14} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            }
            return (
              <button
                key={label}
                type="button"
                className="oc-ai-btn"
                disabled
                aria-disabled="true"
                title="即將推出"
              >
                <span>{label}</span>
                <Lock size={14} aria-hidden="true" />
              </button>
            );
          })}
          {ai && aiReason !== undefined && (
            <span id={aiReasonId} className="oc-visually-hidden">
              {aiReason}
            </span>
          )}
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
