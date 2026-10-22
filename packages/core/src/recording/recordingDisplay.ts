/**
 * RMS a bar needs to light up, quietest first. The first step equals SegmentPolicy's default
 * silence threshold (0.01), so 0 bars means "silence".
 */
export const LEVEL_STEPS: readonly number[] = [0.01, 0.03, 0.06, 0.12, 0.2];

/** Number of bars in the level meter. */
export const LEVEL_BARS = LEVEL_STEPS.length;

/** How many bars a microphone reading lights (0–5); NaN lights none. */
export function levelToBars(rms: number): number {
  return LEVEL_STEPS.filter((step) => rms >= step).length;
}

/** Elapsed recording time as mm:ss, whole seconds rounded down; minutes may exceed 99. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
