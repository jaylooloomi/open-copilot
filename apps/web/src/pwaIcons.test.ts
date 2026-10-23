// @vitest-environment node
// (sharp returns Node Buffers; under jsdom Uint8Array comes from another realm.)
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ICON_OUTPUT_DIR, ICONS, renderIcon } from '../scripts/icons';

async function rgba(input: Buffer | string) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// Rasterizers round differently across platforms by a step or so; an edited SVG differs far more.
// The mean catches broad changes; the count of strongly changed pixels catches small local edits.
function drift(fresh: Uint8Array, committed: Uint8Array) {
  let total = 0;
  let changedPixels = 0;
  for (let p = 0; p < fresh.length; p += 4) {
    let strong = false;
    for (let c = p; c < p + 4; c += 1) {
      const d = Math.abs(fresh[c]! - committed[c]!);
      total += d;
      if (d > 64) strong = true;
    }
    if (strong) changedPixels += 1;
  }
  return { mean: total / fresh.length, changedShare: changedPixels / (fresh.length / 4) };
}

const MAX_MEAN = 2;
const MAX_CHANGED_SHARE = 0.001;

describe('PWA icons', () => {
  it('flags a small recolored patch that the mean difference alone would miss', () => {
    const size = 512;
    const base = new Uint8Array(size * size * 4).fill(255);
    const edited = base.slice();
    for (let y = 0; y < 32; y += 1)
      for (let x = 0; x < 32; x += 1) edited.fill(0, (y * size + x) * 4, (y * size + x) * 4 + 3);
    const result = drift(edited, base);
    expect(result.mean).toBeLessThan(MAX_MEAN);
    expect(result.changedShare).toBeGreaterThan(MAX_CHANGED_SHARE);
    expect(drift(base, base)).toEqual({ mean: 0, changedShare: 0 });
  });

  it('lists the 192, 512 and maskable 512 icons from the two SVG sources', () => {
    expect(ICONS.map((icon) => [icon.source, icon.output, icon.size])).toEqual([
      ['icon.svg', 'icon-192.png', 192],
      ['icon.svg', 'icon-512.png', 512],
      ['icon-maskable.svg', 'icon-maskable-512.png', 512],
    ]);
  });

  it.each(ICONS)(
    'commits $output at $size px, matching its SVG source',
    async (icon) => {
      const file = join(ICON_OUTPUT_DIR, icon.output);
      expect(existsSync(file), `${file} is missing: run npm run icons -w @oc/web`).toBe(true);
      const committed = await rgba(file);
      const fresh = await rgba(await renderIcon(icon));
      expect([committed.width, committed.height]).toEqual([icon.size, icon.size]);
      const { mean, changedShare } = drift(fresh.data, committed.data);
      const hint = 'run npm run icons -w @oc/web and commit the PNGs';
      expect(mean, hint).toBeLessThan(MAX_MEAN);
      expect(changedShare, hint).toBeLessThanOrEqual(MAX_CHANGED_SHARE);
    },
    30_000,
  );

  it('fills the maskable icon to the corners (launchers crop it to their own shape)', async () => {
    const icon = ICONS.find((entry) => entry.output === 'icon-maskable-512.png')!;
    const { data, width } = await rgba(await renderIcon(icon));
    const alphaAt = (x: number, y: number) => data[(y * width + x) * 4 + 3];
    expect([alphaAt(0, 0), alphaAt(width - 1, 0), alphaAt(0, width - 1), alphaAt(width - 1, width - 1)]).toEqual([
      255, 255, 255, 255,
    ]);
  });
});
