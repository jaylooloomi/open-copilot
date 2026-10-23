import { useEffect, useRef, useState } from 'react';
import { useLevel, type LevelSource } from '../recording/levelStore';
import { formatElapsed, LEVEL_BARS, levelToBars } from '../recording/recordingDisplay';

export interface RecordingStatusProps {
  /** The recorder state is 'recording' (not 'stopping'). */
  recording: boolean;
  /** When the recording started (epoch ms); null when not recording. */
  startedAt: number | null;
  /** Microphone level; without it the meter stays dark. */
  levels?: LevelSource;
  /** Segments uploaded but not inserted yet. */
  transcribing: number;
  /** Clock for the timer (tests may replace it). */
  now?: () => number;
}

/** Timer, level meter and 轉寫中 N 段 next to the record button. */
export function RecordingStatus({ recording, startedAt, levels, transcribing, now = Date.now }: RecordingStatusProps) {
  const live = recording && startedAt !== null;
  if (!live && transcribing <= 0) return null;
  return (
    <div className="oc-rec-status">
      {live && <RecordingTimer startedAt={startedAt} now={now} />}
      {live && <LevelMeter levels={levels} />}
      {transcribing > 0 && (
        <span className="oc-transcribing" role="status">
          {`轉寫中 ${transcribing} 段`}
        </span>
      )}
    </div>
  );
}

function RecordingTimer({ startedAt, now }: { startedAt: number; now: () => number }) {
  const [elapsed, setElapsed] = useState(() => now() - startedAt);
  // Read the clock through a ref, so a caller passing an inline `now` does not restart the interval.
  const nowRef = useRef(now);
  useEffect(() => {
    nowRef.current = now;
  });
  useEffect(() => {
    setElapsed(nowRef.current() - startedAt);
    // Recomputed from the clock, so a late tick never lets the timer drift.
    const id = setInterval(() => setElapsed(nowRef.current() - startedAt), 250);
    return () => clearInterval(id);
  }, [startedAt]);
  return (
    <span className="oc-rec-timer" role="timer" aria-label="錄音時間">
      {formatElapsed(elapsed)}
    </span>
  );
}

function LevelMeter({ levels }: { levels: LevelSource | undefined }) {
  const bars = levelToBars(useLevel(levels));
  return (
    <span className="oc-level-meter" aria-hidden="true" data-level={bars}>
      {Array.from({ length: LEVEL_BARS }, (_, index) => (
        <span key={index} className={index < bars ? 'oc-level-bar is-on' : 'oc-level-bar'} />
      ))}
    </span>
  );
}
