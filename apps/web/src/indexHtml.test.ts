import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = resolve(dirname(fileURLToPath(import.meta.url)), '../index.html');

describe('index.html', () => {
  it('does not ask for edge-to-edge (viewport-fit=cover): the layout has no safe-area padding', () => {
    // With viewport-fit=cover, Capacitor 8 on Android WebView >= 140 draws the page under the
    // status and navigation bars; without it, Capacitor pads the WebView instead.
    const viewport = readFileSync(INDEX_HTML, 'utf8').match(
      /<meta name="viewport" content="([^"]*)"/,
    )?.[1];
    expect(viewport).toBe('width=device-width, initial-scale=1');
  });
});
