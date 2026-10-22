import { describe, expect, it } from 'vitest';
import { formatElapsed, LEVEL_BARS, LEVEL_STEPS, levelToBars } from './recordingDisplay';

describe('formatElapsed', () => {
  it.each([
    [0, '00:00'],
    [999, '00:00'],
    [1_000, '00:01'],
    [59_999, '00:59'],
    [65_000, '01:05'],
    [600_000, '10:00'],
    [3_600_000, '60:00'],
    [6_000_000, '100:00'],
  ])('formats %d ms as %s', (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });

  it.each([-5, Number.NaN, Number.NEGATIVE_INFINITY])('shows 00:00 for %d', (ms) => {
    expect(formatElapsed(ms)).toBe('00:00');
  });
});

describe('levelToBars', () => {
  it('has five bars, one per step', () => {
    expect(LEVEL_BARS).toBe(5);
    expect(LEVEL_STEPS).toEqual([0.01, 0.03, 0.06, 0.12, 0.2]);
  });

  it.each([
    [0, 0],
    [0.009, 0],
    [0.01, 1],
    [0.05, 2],
    [0.06, 3],
    [0.15, 4],
    [0.2, 5],
    [1, 5],
    [Number.NaN, 0],
    [-1, 0],
  ])('lights %d as %d bars', (rms, bars) => {
    expect(levelToBars(rms)).toBe(bars);
  });
});
