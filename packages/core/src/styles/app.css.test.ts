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

  it('dims disabled delete buttons everywhere they show and gives them no hover colour', () => {
    // .oc-note-item.is-active .oc-note-delete (0,3,0) must not out-rank the disabled look.
    expect(css).toMatch(/\.oc-note-item\.is-active \.oc-note-delete:disabled[^{]*\{[^}]*opacity:\s*0\.5/);
    expect(css).toMatch(/\.oc-note-delete:hover:not\(:disabled\)\s*\{/);
    expect(selectorLists(css)).not.toContain('.oc-note-delete:hover');
  });

  it('keeps the record button one width for every label, so the action bar does not shift', () => {
    expect(css).toMatch(/\.oc-record-btn\s*\{[^}]*min-width:[^}]*justify-content:\s*center/);
  });

  it('dims disabled backup buttons and gives them no hover colour', () => {
    expect(css).toMatch(/\.oc-backup-btn:disabled\s*\{[^}]*opacity:\s*0\.5/);
    expect(css).toMatch(/\.oc-backup-btn:hover:not\(:disabled\)\s*\{/);
  });

  it('keeps the backup buttons at the bottom of the scrolling sidebar, however long the list', () => {
    // .oc-sidebar scrolls (overflow-y: auto); the footer must not scroll out of view with the notes.
    expect(css).toMatch(
      /\.oc-notelist-footer\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*0[^}]*background:\s*var\(--oc-surface\)/,
    );
  });

  it('drops the toolbar group dividers on narrow screens, where groups wrap onto new rows', () => {
    // A divider would otherwise hang at the end of a wrapped row with nothing after it.
    const narrow = css.slice(css.indexOf('@media (max-width: 767.98px)'));
    expect(narrow).toMatch(/\.oc-tool-group\s*\{[^}]*border-right:\s*none/);
  });

  it('keeps the recording timer one width as its digits change', () => {
    expect(css).toMatch(/\.oc-rec-timer\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });

  it('keeps the recording status on one line beside the record button', () => {
    expect(css).toMatch(/\.oc-rec-status\s*\{[^}]*flex-shrink:\s*0[^}]*white-space:\s*nowrap/);
  });

  it('lets only the 轉寫中 N 段 text give way on narrow screens, so the gear stays on screen', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 767.98px)'));
    expect(narrow).toMatch(/\.oc-rec-status\s*\{[^}]*flex-shrink:\s*1[^}]*min-width:\s*0/);
    expect(narrow).toMatch(/\.oc-transcribing\s*\{[^}]*text-overflow:\s*ellipsis/);
  });

  it('gives the AI chips only the space left beside the recording status on narrow screens', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 767.98px)'));
    // Sized from 0 rather than from the chips' full width, so they give way before the status does.
    expect(narrow).toMatch(/\.oc-actionbar-end\s*\{[^}]*flex:\s*1 1 0[^}]*min-width:\s*34px/);
  });

  it('lights level bars in the primary colour', () => {
    expect(css).toMatch(/\.oc-level-bar\.is-on\s*\{[^}]*background:\s*var\(--oc-primary\)/);
  });
});
