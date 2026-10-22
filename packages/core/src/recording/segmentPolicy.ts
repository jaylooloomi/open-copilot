export interface SegmentPolicyOptions {
  /** No cut before this much audio (default 4000ms). */
  minMs?: number;
  /** Always cut at this length (default 8000ms). */
  maxMs?: number;
  /** A pause must last this long (default 300ms). */
  silenceMs?: number;
  /** RMS below this counts as silence (default 0.01). */
  threshold?: number;
}

/**
 * Decides when to end a recording segment: at a pause (RMS < threshold for silenceMs) once minMs
 * have passed, or at maxMs regardless. Call start() at the beginning of every segment.
 */
export class SegmentPolicy {
  private readonly minMs: number;
  private readonly maxMs: number;
  private readonly silenceMs: number;
  private readonly threshold: number;
  private startMs = 0;
  private silenceStartMs: number | null = null;

  constructor(options: SegmentPolicyOptions = {}) {
    this.minMs = options.minMs ?? 4000;
    this.maxMs = options.maxMs ?? 8000;
    this.silenceMs = options.silenceMs ?? 300;
    this.threshold = options.threshold ?? 0.01;
    for (const [name, value] of Object.entries({
      minMs: this.minMs,
      maxMs: this.maxMs,
      silenceMs: this.silenceMs,
      threshold: this.threshold,
    })) {
      if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`SegmentPolicy ${name} must be a finite number >= 0, got ${value}`);
      }
    }
    if (this.minMs > this.maxMs) {
      throw new RangeError(`SegmentPolicy minMs (${this.minMs}) must not exceed maxMs (${this.maxMs})`);
    }
  }

  start(nowMs: number): void {
    this.startMs = nowMs;
    this.silenceStartMs = null;
  }

  /** A NaN rms counts as speech (it resets the pause timer), so a bad reading never causes an early cut. */
  update(nowMs: number, rms: number): 'continue' | 'cut' {
    if (rms < this.threshold) this.silenceStartMs ??= nowMs;
    else this.silenceStartMs = null;

    const elapsed = nowMs - this.startMs;
    if (elapsed >= this.maxMs) return 'cut';
    const pausedFor = this.silenceStartMs === null ? 0 : nowMs - this.silenceStartMs;
    if (elapsed >= this.minMs && pausedFor >= this.silenceMs) return 'cut';
    return 'continue';
  }
}
