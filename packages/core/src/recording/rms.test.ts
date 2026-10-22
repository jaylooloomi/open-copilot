import { describe, expect, it } from 'vitest';
import { computeRms } from './rms';

describe('computeRms', () => {
  it('is 0 for silence and for an empty buffer', () => {
    expect(computeRms(new Float32Array(128))).toBe(0);
    expect(computeRms(new Float32Array(0))).toBe(0);
  });

  it('is the amplitude of a constant or square signal', () => {
    expect(computeRms(new Float32Array([0.5, 0.5, 0.5, 0.5]))).toBeCloseTo(0.5);
    expect(computeRms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
  });

  it('is amplitude / sqrt(2) for a sine wave', () => {
    const sine = Float32Array.from({ length: 1000 }, (_, i) => Math.sin((2 * Math.PI * i) / 100));
    expect(computeRms(sine)).toBeCloseTo(Math.SQRT1_2, 3);
  });
});
