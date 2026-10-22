import type { JSONContent, Note } from '@oc/shared';
import {
  formatListItem,
  isTaskChecked,
  linkRuns,
  listStart,
  nodeText,
  TASK_LIST_TYPE,
  TRANSCRIPT_GAP_TEXT,
  TRANSCRIPT_GAP_TYPE,
} from './common';

type MdMark = 'underline' | 'bold' | 'italic';

/**
 * Nesting order, outermost first. Underline is outermost so `<u>` never sits between `**` / `*`
 * and the text they wrap. Text colour, highlight and every other mark are dropped.
 */
const MD_MARKS: readonly MdMark[] = ['underline', 'bold', 'italic'];
const OPEN: Record<MdMark, string> = { underline: '<u>', bold: '**', italic: '*' };
const CLOSE: Record<MdMark, string> = { underline: '</u>', bold: '**', italic: '*' };
const HARD_BREAK = '\\\n';

/** Splits text into leading spaces, the rest, and trailing spaces. */
const SPACE_EDGES = /^(\s*)([\s\S]*?)(\s*)$/u;
/**
 * Same, but also moves Unicode punctuation and symbols to the edges. CommonMark only lets `**` / `*`
 * open or close next to punctuation when the other side is a space or punctuation too, so
 * `**重點：**內容` would stay literal; `**重點**：內容` works.
 */
const PUNCTUATION_EDGES = /^([\s\p{P}\p{S}]*)([\s\S]*?)([\s\p{P}\p{S}]*)$/u;

/**
 * Markdown: `# title`, body headings one level lower (`##`–`####`), `**bold**`, `*italic*`,
 * `<u>underline</u>`, `[text](href)` links, `- ` / `1. ` lists and `- [ ]` / `- [x]` task lists.
 * Colour, highlight and alignment are dropped.
 */
export function toMarkdown(note: Note): string {
  const blocks = renderBlocks(note.content.content ?? []);
  const title = note.title.trim();
  if (title) blocks.unshift(`# ${escapeHeadingEnd(escapeInline(title))}`);
  return blocks.length > 0 ? `${blocks.join('\n\n')}\n` : '';
}

function renderBlocks(nodes: JSONContent[]): string[] {
  const blocks: string[] = [];
  let previous: JSONContent | undefined;
  for (const node of nodes) {
    const block = renderBlock(node);
    if (block === '') continue;
    if (previous && listsWouldMerge(previous, node)) blocks.push(LIST_SEPARATOR);
    blocks.push(block);
    previous = node;
  }
  return blocks;
}

/**
 * Written between two adjacent lists that Markdown would otherwise read as one list. An HTML
 * comment ends a list and renders as nothing.
 */
const LIST_SEPARATOR = '<!-- -->';

/**
 * Whether two adjacent lists use the same kind of marker and would merge into one list when only
 * a blank line separates them: bullet and task lists both use `-`, ordered lists all use `.`.
 */
function listsWouldMerge(a: JSONContent, b: JSONContent): boolean {
  const family = (node: JSONContent) =>
    node.type === 'orderedList' ? 'ordered' : isList(node) ? 'dash' : undefined;
  const kind = family(a);
  return kind !== undefined && kind === family(b);
}

function renderBlock(node: JSONContent): string {
  switch (node.type) {
    case 'paragraph':
      return finishLines(renderInline(node.content));
    case 'heading': {
      // ATX headings are one line, so hard breaks become spaces.
      const text = escapeHeadingEnd(
        finishLines(renderInline(node.content)).replaceAll(HARD_BREAK, ' '),
      );
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 5);
      return text ? `${'#'.repeat(level + 1)} ${text}` : '';
    }
    case 'bulletList':
    case 'orderedList':
    case TASK_LIST_TYPE:
      return renderList(node);
    default:
      // Unknown block: its text content, one paragraph per line.
      return nodeText(node)
        .split('\n')
        .map((line) => finishLines(escapeInline(line)))
        .filter((line) => line !== '')
        .join('\n\n');
  }
}

function renderList(list: JSONContent): string {
  const ordered = list.type === 'orderedList';
  const task = list.type === TASK_LIST_TYPE;
  const start = listStart(list);
  return (list.content ?? [])
    .map((item, index) => {
      let marker = '- ';
      if (task) marker = isTaskChecked(item) ? '- [x] ' : '- [ ] ';
      else if (ordered) marker = `${start + index}. `;
      let body = '';
      let previous: JSONContent | undefined;
      for (const child of item.content ?? []) {
        const block = renderBlock(child);
        if (block === '') continue;
        if (previous && listsWouldMerge(previous, child)) body += `\n\n${LIST_SEPARATOR}\n\n`;
        else if (body !== '') body += canInterruptParagraph(child, block) ? '\n' : '\n\n';
        body += block;
        previous = child;
      }
      // GFM needs whitespace after `]` to read a task marker, so an empty item keeps `- [ ] ` untrimmed
      // (formatListItem would trim it to `- [ ]`, a bullet whose text is `[ ]`).
      if (task && body === '') return marker;
      // GFM reads `[ ]` as part of the item text, so nested lines line up after `- `.
      return formatListItem(marker, body, task ? 2 : marker.length);
    })
    .join('\n');
}

function isList(node: JSONContent): boolean {
  return node.type === 'bulletList' || node.type === 'orderedList' || node.type === TASK_LIST_TYPE;
}

/**
 * Whether a rendered block may start on the line right after a paragraph in the same list item.
 * Only a list may, and CommonMark lets it interrupt a paragraph only when it is a bullet list or
 * starts at 1, and its first item is not empty (a lone `-` would turn the paragraph into a heading).
 */
function canInterruptParagraph(node: JSONContent, block: string): boolean {
  if (!isList(node)) return false;
  if (node.type === 'orderedList' && listStart(node) !== 1) return false;
  return !/^(?:-|\d+\.)$/.test(block.split('\n', 1)[0]);
}

/** Inline content; each link becomes `[text](href)` around its own marked text. */
function renderInline(nodes: JSONContent[] = []): string {
  return linkRuns(nodes)
    .map(({ href, nodes: run }) => {
      const inner = renderMarked(run);
      return href && inner !== '' ? `[${inner}](${linkDestination(href)})` : inner;
    })
    .join('');
}

/** A link destination CommonMark reads back unchanged: no spaces or angle brackets, parentheses escaped. */
function linkDestination(href: string): string {
  return href.replace(/[\s<>]/g, (c) => encodeURIComponent(c)).replace(/[()\\]/g, '\\$&');
}

/**
 * Renders inline content outside links, opening and closing delimiters only where the set of marks changes.
 * Spaces (and, around `**` / `*`, punctuation) at the edges of a text node are written outside the
 * delimiters, so every `**` / `*` touches a letter and CommonMark accepts it.
 */
function renderMarked(nodes: JSONContent[]): string {
  let out = '';
  let open: MdMark[] = [];
  /** Escaped spaces and punctuation to write between the next closing and opening delimiters. */
  let pending = '';

  const setMarks = (wanted: MdMark[]) => {
    let keep = 0;
    while (keep < open.length && keep < wanted.length && open[keep] === wanted[keep]) keep += 1;
    for (let i = open.length - 1; i >= keep; i -= 1) out += CLOSE[open[i]];
    out += pending;
    pending = '';
    for (let i = keep; i < wanted.length; i += 1) out += OPEN[wanted[i]];
    open = wanted;
  };

  for (const node of nodes) {
    if (node.type === 'text') {
      const marks = MD_MARKS.filter((mark) => node.marks?.some((m) => m.type === mark));
      const edges = marks.some((mark) => mark !== 'underline') ? PUNCTUATION_EDGES : SPACE_EDGES;
      // Escape first: an escape such as `\*` is two punctuation characters, so it is never split.
      const [, lead, core, trail] = edges.exec(escapeInline(node.text ?? '')) ?? ['', '', '', ''];
      pending += lead;
      if (core === '') continue;
      setMarks(marks);
      out += core;
      pending = trail;
    } else if (node.type === 'hardBreak') {
      setMarks([]);
      out += HARD_BREAK;
    } else if (node.type === TRANSCRIPT_GAP_TYPE) {
      setMarks([]);
      // Escaped so that a following `(…)` or `[…]` cannot turn it into a link.
      out += escapeInline(TRANSCRIPT_GAP_TEXT);
    } else {
      setMarks([]);
      out += escapeInline(nodeText(node)).replaceAll('\n', HARD_BREAK);
    }
  }
  setMarks([]);
  return out;
}

/**
 * Backslash-escapes characters that would otherwise start Markdown or HTML syntax, and an `&` that
 * would start an entity reference (`&copy;` would render as ©).
 */
function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]<~]|&(?=#?[0-9A-Za-z]+;)/g, '\\$&');
}

/** A run of `#` at the end of an ATX heading, after a space or alone, is read as its closing sequence. */
function escapeHeadingEnd(text: string): string {
  return text.replace(/(^|[ \t])(#+)$/, '$1\\$2');
}

/**
 * Removes leading/trailing spaces and hard breaks, strips each line's leading spaces and escapes
 * characters that would turn a line into a heading, quote or list.
 */
function finishLines(inline: string): string {
  return inline
    .replace(/^(?:[ \t]|\\\n)+/, '')
    .replace(/(?:[ \t]|\\\n)+$/, '')
    .split('\n')
    .map((line) =>
      line
        .replace(/^[ \t]+/, '')
        .replace(/^([#>+=-])/, '\\$1')
        .replace(/^(\d{1,9})([.)])/, '$1\\$2'),
    )
    .join('\n');
}
