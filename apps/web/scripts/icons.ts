// PWA icons (add-ons design 4): PNGs rendered from the SVG sources in apps/web/icons and
// committed under apps/web/public/icons. src/pwaIcons.test.ts checks they are up to date.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const WEB_DIR = fileURLToPath(new URL('..', import.meta.url));
export const ICON_SOURCE_DIR = join(WEB_DIR, 'icons');
export const ICON_OUTPUT_DIR = join(WEB_DIR, 'public', 'icons');

export interface IconSpec {
  /** SVG file in apps/web/icons. */
  source: string;
  /** PNG file in apps/web/public/icons (served as /icons/<output>). */
  output: string;
  size: number;
}

export const ICONS: readonly IconSpec[] = [
  { source: 'icon.svg', output: 'icon-192.png', size: 192 },
  { source: 'icon.svg', output: 'icon-512.png', size: 512 },
  { source: 'icon-maskable.svg', output: 'icon-maskable-512.png', size: 512 },
];

export async function renderIcon(icon: IconSpec): Promise<Buffer> {
  const svg = await readFile(join(ICON_SOURCE_DIR, icon.source));
  // 144 dpi draws the 512-unit SVG at 1024 px; scaling down from there gives clean edges.
  return sharp(svg, { density: 144 })
    .resize(icon.size, icon.size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Writes every PNG and returns their paths. */
export async function writeIcons(): Promise<string[]> {
  await mkdir(ICON_OUTPUT_DIR, { recursive: true });
  const written: string[] = [];
  for (const icon of ICONS) {
    const path = join(ICON_OUTPUT_DIR, icon.output);
    await writeFile(path, await renderIcon(icon));
    written.push(path);
  }
  return written;
}
