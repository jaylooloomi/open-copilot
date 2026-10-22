import { describe, expect, it } from 'vitest';
import { SegmentPolicy } from './segmentPolicy';

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
  it('never cuts before 4 seconds, even during a pause', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    expect(run(policy, 50, 3950, () => SILENCE)).toBeUndefined();
  });

  it('cuts at 4 seconds when a pause of 300ms is already going on', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    expect(run(policy, 50, 8000, (t) => (t < 3500 ? SPEECH : SILENCE))).toBe(4000);
  });

  it('cuts once a pause after 4 seconds has lasted 300ms', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    // Silence starts at 5000; 300ms later is 5300.
    expect(run(policy, 50, 8000, (t) => (t < 5000 ? SPEECH : SILENCE))).toBe(5300);
  });

  it('restarts the pause timer when speech comes back', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    const rmsAt = (t: number) => {
      if (t >= 5000 && t < 5200) return SILENCE; // too short
      if (t >= 6000) return SILENCE;
      return SPEECH;
    };
    expect(run(policy, 50, 8000, rmsAt)).toBe(6300);
  });

  it('forces a cut at 8 seconds without any pause', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    expect(run(policy, 50, 10_000, () => SPEECH)).toBe(8000);
  });

  it('treats values at or above the 0.01 threshold as speech', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    expect(run(policy, 50, 10_000, () => 0.01)).toBe(8000);
  });

  it('measures each segment from its own start', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    expect(run(policy, 50, 10_000, () => SPEECH)).toBe(8000);
    policy.start(8000);
    expect(run(policy, 8050, 20_000, () => SPEECH)).toBe(16_000);
  });

  it('accepts custom limits', () => {
    const policy = new SegmentPolicy({ minMs: 1000, maxMs: 2000, silenceMs: 100, threshold: 0.5 });
    policy.start(0);
    expect(run(policy, 50, 5000, (t) => (t < 1200 ? 0.6 : 0.4))).toBe(1300);
  });
});
