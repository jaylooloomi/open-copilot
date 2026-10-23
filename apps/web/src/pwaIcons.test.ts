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

describe('PWA icons', () => {
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
      let diff = 0;
      for (let i = 0; i < fresh.data.length; i += 1) diff += Math.abs(fresh.data[i]! - committed.data[i]!);
      // Rasterizers round differently across platforms by a step or so; an edited SVG differs far more.
      expect(diff / fresh.data.length, 'run npm run icons -w @oc/web and commit the PNGs').toBeLessThan(2);
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
