/** RMS below this counts as silence unless a caller passes its own threshold. */
export const DEFAULT_SILENCE_THRESHOLD = 0.01;

/**
 * Default segment length limits. Groq bills every request as at least 10 s of audio, so 8–12 s
 * segments keep an hour of recording near 6,000 billed seconds, under the free tier's 7,200 per
 * hour (add-ons design 1.2).
 */
export const DEFAULT_MIN_SEGMENT_MS = 8000;
export const DEFAULT_MAX_SEGMENT_MS = 12000;

export interface SegmentPolicyOptions {
  /** No cut before this much audio (default 8000ms). */
  minMs?: number;
  /** Always cut at this length (default 12000ms). */
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
    this.minMs = options.minMs ?? DEFAULT_MIN_SEGMENT_MS;
    this.maxMs = options.maxMs ?? DEFAULT_MAX_SEGMENT_MS;
    this.silenceMs = options.silenceMs ?? 300;
    this.threshold = options.threshold ?? DEFAULT_SILENCE_THRESHOLD;
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
