import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_SEGMENT_MS,
  DEFAULT_MIN_SEGMENT_MS,
  DEFAULT_SILENCE_MS,
  SegmentPolicy,
} from './segmentPolicy';

const SPEECH = 0.2;
const SILENCE = 0.001;

/** Feeds one rms value every 50ms from `fromMs` up to and including `toMs`; returns the first cut time. */
function run(policy: SegmentPolicy, fromMs: number, toMs: number, rmsAt: (t: number) => number) {
  for (let t = fromMs; t <= toMs; t += 50) {
    if (policy.update(t, rmsAt(t)) === 'cut') return t;
  }
  return undefined;
}

describe('SegmentPolicy', () => {
  it('defaults to 8–12 second segments (Groq bills every request as at least 10 s)', () => {
    expect(DEFAULT_MIN_SEGMENT_MS).toBe(8000);
    expect(DEFAULT_MAX_SEGMENT_MS).toBe(12000);
    expect(DEFAULT_SILENCE_MS).toBe(300);
  });

  it('never cuts before 8 seconds, even during a pause', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    expect(run(policy, 50, 7950, () => SILENCE)).toBeUndefined();
  });

  it('cuts at 8 seconds when a pause of 300ms is already going on', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    expect(run(policy, 50, 12_000, (t) => (t < 7500 ? SPEECH : SILENCE))).toBe(8000);
  });

  it('cuts once a pause after 8 seconds has lasted 300ms', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    // Silence starts at 9000; 300ms later is 9300.
    expect(run(policy, 50, 12_000, (t) => (t < 9000 ? SPEECH : SILENCE))).toBe(9300);
  });

  it('restarts the pause timer when speech comes back', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    const rmsAt = (t: number) => {
      if (t >= 9000 && t < 9200) return SILENCE; // too short
      if (t >= 10_000) return SILENCE;
      return SPEECH;
    };
    expect(run(policy, 50, 12_000, rmsAt)).toBe(10_300);
  });

  it('forces a cut at 12 seconds without any pause', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    expect(run(policy, 50, 15_000, () => SPEECH)).toBe(12_000);
  });

  it('treats values at or above the 0.01 threshold as speech', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    expect(run(policy, 50, 15_000, () => 0.01)).toBe(12_000);
  });

  it('measures each segment from its own start', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    expect(run(policy, 50, 15_000, () => SPEECH)).toBe(12_000);
    policy.start(12_000);
    expect(run(policy, 12_050, 30_000, () => SPEECH)).toBe(24_000);
  });

  it('accepts custom limits', () => {
    const policy = new SegmentPolicy({ minMs: 1000, maxMs: 2000, silenceMs: 100, threshold: 0.5 });
    policy.start(0);
    expect(run(policy, 50, 5000, (t) => (t < 1200 ? 0.6 : 0.4))).toBe(1300);
  });

  it('rejects options that are negative, not finite, or have minMs above maxMs', () => {
    expect(() => new SegmentPolicy({ maxMs: Number.NaN })).toThrow(RangeError);
    expect(() => new SegmentPolicy({ minMs: -1 })).toThrow(RangeError);
    expect(() => new SegmentPolicy({ silenceMs: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => new SegmentPolicy({ threshold: -0.1 })).toThrow(RangeError);
    expect(() => new SegmentPolicy({ minMs: 9000, maxMs: 8000 })).toThrow(RangeError);
    // A custom minimum above the default maximum needs its own maximum.
    expect(() => new SegmentPolicy({ minMs: 13_000 })).toThrow(RangeError);
    expect(() => new SegmentPolicy({ minMs: 5000, maxMs: 5000 })).not.toThrow();
  });

  it('treats a NaN rms reading as speech, so it resets the pause timer', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    const rmsAt = (t: number) => {
      if (t === 9100) return Number.NaN;
      return t < 9000 ? SPEECH : SILENCE;
    };
    // Silence from 9000 is interrupted by NaN at 9100; the pause restarts at 9150 and cuts at 9450.
    expect(run(policy, 50, 12_000, rmsAt)).toBe(9450);
  });
});
