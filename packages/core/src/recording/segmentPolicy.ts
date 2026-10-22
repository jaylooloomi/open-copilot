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
  }

  start(nowMs: number): void {
    this.startMs = nowMs;
    this.silenceStartMs = null;
  }

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
