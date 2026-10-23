import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = resolve(HERE, '../index.html');
const APP_CSS = resolve(HERE, '../../../packages/core/src/styles/app.css');

describe('index.html', () => {
  it('does not ask for edge-to-edge (viewport-fit=cover): the layout has no safe-area padding', () => {
    // With viewport-fit=cover, Capacitor 8 on Android WebView >= 140 draws the page under the
    // status and navigation bars; without it, Capacitor pads the WebView instead.
    const viewport = readFileSync(INDEX_HTML, 'utf8').match(
      /<meta name="viewport" content="([^"]*)"/,
    )?.[1];
    expect(viewport).toBe('width=device-width, initial-scale=1');
  });

  it('uses the committed PWA icon for the tab and the iOS home screen', () => {
    const html = readFileSync(INDEX_HTML, 'utf8');
    expect(html).toContain('<link rel="icon" type="image/png" href="/icons/icon-192.png" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/icon-192.png" />');
  });

  it('uses the brand color (--oc-primary) as theme-color, like the manifest', () => {
    const primary = readFileSync(APP_CSS, 'utf8').match(/--oc-primary:\s*(#[0-9a-f]{6});/i)?.[1];
    const themeColor = readFileSync(INDEX_HTML, 'utf8').match(
      /<meta name="theme-color" content="([^"]*)"/,
    )?.[1];
    expect(primary).toBe('#c026d3');
    expect(themeColor).toBe(primary);
  });
});
