/** A reading below this counts as silence (SegmentPolicy's default threshold). */
export const NO_SOUND_THRESHOLD = 0.01;

/** The hint shows once readings stayed below the threshold for longer than this. */
export const NO_SOUND_AFTER_MS = 10_000;

export interface NoSoundOptions {
  threshold?: number;
  afterMs?: number;
}

/**
 * Decides when to show 沒有偵測到聲音，請確認麥克風: after more than `afterMs` without any reading at
 * or above the threshold, counted from the start of the recording. Shown at most once per
 * recording (one detector per recording); a loud reading hides it.
 */
export class NoSoundDetector {
  private readonly threshold: number;
  private readonly afterMs: number;
  private quietSinceMs: number;
  private shownOnce = false;
  private visible = false;

  constructor(startMs: number, options: NoSoundOptions = {}) {
    this.threshold = options.threshold ?? NO_SOUND_THRESHOLD;
    this.afterMs = options.afterMs ?? NO_SOUND_AFTER_MS;
    this.quietSinceMs = startMs;
  }

  /** Feeds one reading; returns whether the hint should be shown now. */
  update(nowMs: number, rms: number): boolean {
    // `!(rms < threshold)` so that NaN counts as sound, as in SegmentPolicy.
    if (!(rms < this.threshold)) {
      this.quietSinceMs = nowMs;
      this.visible = false;
      return false;
    }
    if (!this.shownOnce && nowMs - this.quietSinceMs > this.afterMs) {
      this.shownOnce = true;
      this.visible = true;
    }
    return this.visible;
  }
}
