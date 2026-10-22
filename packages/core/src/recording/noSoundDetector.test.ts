import { describe, expect, it } from 'vitest';
import { NO_SOUND_AFTER_MS, NO_SOUND_THRESHOLD, NoSoundDetector } from './noSoundDetector';
import { DEFAULT_SILENCE_THRESHOLD } from './segmentPolicy';

describe('NoSoundDetector', () => {
  it('uses the silence threshold of SegmentPolicy and 10 seconds', () => {
    expect(NO_SOUND_THRESHOLD).toBe(DEFAULT_SILENCE_THRESHOLD);
    expect(DEFAULT_SILENCE_THRESHOLD).toBe(0.01);
    expect(NO_SOUND_AFTER_MS).toBe(10_000);
  });

  it('shows the hint once more than 10 s passed since the start without a loud reading', () => {
    const detector = new NoSoundDetector(1_000);
    expect(detector.update(6_000, 0.009)).toBe(false);
    expect(detector.update(11_000, 0)).toBe(false); // exactly 10 s: not over yet
    expect(detector.update(11_001, 0)).toBe(true);
    expect(detector.update(12_000, 0)).toBe(true);
  });

  it('hides the hint as soon as a reading reaches the threshold', () => {
    const detector = new NoSoundDetector(0);
    expect(detector.update(10_100, 0)).toBe(true);
    expect(detector.update(10_200, 0.01)).toBe(false);
  });

  it('shows the hint only once per recording', () => {
    const detector = new NoSoundDetector(0);
    expect(detector.update(10_100, 0)).toBe(true);
    expect(detector.update(10_200, 0.5)).toBe(false);
    expect(detector.update(40_000, 0)).toBe(false);
  });

  it('counts the quiet time from the last loud reading', () => {
    const detector = new NoSoundDetector(0);
    expect(detector.update(5_000, 0.3)).toBe(false);
    expect(detector.update(15_000, 0)).toBe(false);
    expect(detector.update(15_001, 0)).toBe(true);
  });

  it('counts a NaN reading as sound, like SegmentPolicy', () => {
    const detector = new NoSoundDetector(0);
    expect(detector.update(9_000, Number.NaN)).toBe(false);
    expect(detector.update(19_000, 0)).toBe(false);
    expect(detector.update(19_001, 0)).toBe(true);
  });

  it('takes its own threshold and delay', () => {
    const detector = new NoSoundDetector(0, { threshold: 0.1, afterMs: 1_000 });
    expect(detector.update(1_001, 0.05)).toBe(true);
    expect(detector.update(1_100, 0.1)).toBe(false);
  });

  it('rejects a negative or non-finite threshold or delay', () => {
    expect(() => new NoSoundDetector(0, { afterMs: -1 })).toThrow(RangeError);
    expect(() => new NoSoundDetector(0, { afterMs: Number.NaN })).toThrow(RangeError);
    expect(() => new NoSoundDetector(0, { threshold: -0.1 })).toThrow(RangeError);
    expect(() => new NoSoundDetector(0, { threshold: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });
});
