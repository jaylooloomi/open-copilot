import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// jsdom replaces the global URL, so resolve the path with node:path instead of new URL().
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'app.css'), 'utf8');

/** Selector lists of every rule, comments removed. */
function selectorLists(source: string): string[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim()).filter((s) => !s.startsWith('@'));
}

describe('app.css', () => {
  it('is loaded', () => {
    expect(css).toContain('.oc-tool-group');
  });

  it('keeps :has() selectors out of shared selector lists', () => {
    // An old WebView that does not know :has() drops the whole list, so the other selectors would be lost too.
    const mixed = selectorLists(css).filter((list) => list.includes(':has(') && list.includes(','));
    expect(mixed).toEqual([]);
  });

  it('drops the toolbar group dividers on narrow screens, where groups wrap onto new rows', () => {
    // A divider would otherwise hang at the end of a wrapped row with nothing after it.
    const narrow = css.slice(css.indexOf('@media (max-width: 767.98px)'));
    expect(narrow).toMatch(/\.oc-tool-group\s*\{[^}]*border-right:\s*none/);
  });
});
