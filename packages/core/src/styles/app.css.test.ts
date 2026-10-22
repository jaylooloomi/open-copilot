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

/** Body of the first `@media (max-width: 767.98px)` block, bounded at its matching closing brace. */
function narrowBlock(source: string): string {
  const start = source.indexOf('@media (max-width: 767.98px)');
  if (start < 0) return '';
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  return '';
}

describe('app.css', () => {
  it('bounds the narrow-screen block at its own closing brace', () => {
    const sample = 'a { x: 1; } @media (max-width: 767.98px) { .b { y: 2; } } .c { z: 3; }';
    expect(narrowBlock(sample)).toContain('.b { y: 2; }');
    expect(narrowBlock(sample)).not.toContain('.c');
  });

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
    const narrow = narrowBlock(css);
    expect(narrow).toMatch(/\.oc-tool-group\s*\{[^}]*border-right:\s*none/);
  });

  it('keeps the recording timer one width as its digits change', () => {
    expect(css).toMatch(/\.oc-rec-timer\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });

  it('keeps the recording status on one line beside the record button', () => {
    expect(css).toMatch(/\.oc-rec-status\s*\{[^}]*flex-shrink:\s*0[^}]*white-space:\s*nowrap/);
  });

  it('lets only the 轉寫中 N 段 text give way on narrow screens, so the gear stays on screen', () => {
    const narrow = narrowBlock(css);
    expect(narrow).toMatch(/\.oc-rec-status\s*\{[^}]*flex-shrink:\s*1[^}]*min-width:\s*0/);
    expect(narrow).toMatch(/\.oc-transcribing\s*\{[^}]*text-overflow:\s*ellipsis/);
  });

  it('gives the AI chips only the space left beside the recording status on narrow screens', () => {
    const narrow = narrowBlock(css);
    // Sized from 0 rather than from the chips' full width, so they give way before the status does.
    const rule = narrow.match(/\.oc-actionbar-end\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/flex:\s*1 1 0\s*;/);
    // Never narrower than the gear: both read the same size token.
    expect(rule).toMatch(/min-width:\s*var\(--oc-gear-size\)\s*;/);
  });

  it('sizes the gear from one token', () => {
    expect(css).toMatch(/:root\s*\{[^}]*--oc-gear-size:\s*34px\s*;/);
    const gear = css.match(/\.oc-settings-btn\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(gear).toMatch(/width:\s*var\(--oc-gear-size\)\s*;/);
    expect(gear).toMatch(/height:\s*var\(--oc-gear-size\)\s*;/);
  });

  it('lights level bars in the primary colour', () => {
    expect(css).toMatch(/\.oc-level-bar\.is-on\s*\{[^}]*background:\s*var\(--oc-primary\)/);
  });

  it('shows task list items with the checkbox beside the text and no bullet', () => {
    expect(css).toMatch(/\.oc-editor \.ProseMirror ul\[data-type='taskList'\]\s*\{[^}]*list-style:\s*none/);
    expect(css).toMatch(/\.oc-editor \.ProseMirror ul\[data-type='taskList'\] > li\s*\{[^}]*display:\s*flex/);
    // Only the item's own paragraph is struck through: unchecked nested items stay plain.
    expect(css).toMatch(
      /\.oc-editor \.ProseMirror ul\[data-type='taskList'\] > li\[data-checked='true'\] > div > p\s*\{[^}]*text-decoration:\s*line-through/,
    );
  });

  it('starts the text of a task item at its top, level with the checkbox', () => {
    // Inside the flex item the paragraph's default 1em margin would push the text a line below the box.
    expect(css).toMatch(
      /\.oc-editor \.ProseMirror ul\[data-type='taskList'\] > li > div > :first-child\s*\{[^}]*margin-top:\s*0/,
    );
    expect(css).toMatch(
      /\.oc-editor \.ProseMirror ul\[data-type='taskList'\] > li > div > :last-child\s*\{[^}]*margin-bottom:\s*0/,
    );
  });

  it('fades the edges of the scrolling AI chips on phones so a cut chip reads as more to scroll', () => {
    expect(narrowBlock(css)).toMatch(/\.oc-ai-group\s*\{[^}]*mask-image:\s*linear-gradient/);
  });

  it('shows 複製 and 匯出 as icons while the AI side panel narrows the toolbar on desktop', () => {
    expect(css).toMatch(
      /@media \(min-width: 768px\) and \(max-width: 1366px\)\s*\{\s*\.oc-app:has\(\.oc-ai-panel\) \.oc-note-actions \.oc-action-btn > span\s*\{[^}]*clip-path:\s*inset\(50%\)/,
    );
  });

  it('styles only the direct items of a task list, not a plain list nested inside one', () => {
    const task = selectorLists(css).filter((s) => s.includes("ul[data-type='taskList'] li"));
    expect(task).toEqual([]);
  });

  it('makes the unlocked AI chips clickable and dims them while disabled', () => {
    expect(css).toMatch(/\.oc-ai-btn\.is-available\s*\{[^}]*color:\s*var\(--oc-primary\)[^}]*cursor:\s*pointer/);
    expect(css).toMatch(/\.oc-ai-btn\.is-available:disabled\s*\{[^}]*cursor:\s*not-allowed[^}]*opacity:\s*0\.5/);
  });

  it('shows the AI panel as a right-hand column, and as a bottom sheet under the drawer on phones', () => {
    expect(css).toMatch(/\.oc-ai-panel\s*\{[^}]*width:\s*320px[^}]*border-left:\s*1px solid var\(--oc-border\)/);
    const narrow = narrowBlock(css);
    // Under the drawer (z-index 40) and its backdrop (30), so the open drawer covers it.
    expect(narrow).toMatch(/\.oc-ai-panel\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*20/);
  });

  it('leaves room under the note for the bottom sheet on phones, so its last lines can scroll clear', () => {
    // A rule of its own: an old WebView that does not know :has() drops only this one.
    expect(narrowBlock(css)).toMatch(/\.oc-app:has\(\.oc-ai-panel\) \.oc-editor\s*\{[^}]*padding-bottom:\s*60vh/);
  });

  it('dims a disabled primary button', () => {
    expect(css).toMatch(/\.oc-primary-btn:disabled\s*\{[^}]*cursor:\s*not-allowed[^}]*opacity:\s*0\.5/);
  });

  it('keeps a disabled AI panel action from taking the hover colours', () => {
    // More specific than `.oc-action-btn:hover`, so it wins while the pointer is over it.
    expect(css).toMatch(
      /\.oc-ai-panel-actions \.oc-action-btn:disabled\s*\{[^}]*border-color:\s*var\(--oc-border\)[^}]*color:\s*var\(--oc-text\)[^}]*cursor:\s*not-allowed[^}]*opacity:\s*0\.5/,
    );
  });
});
