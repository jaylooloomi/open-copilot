import type { JSONContent } from '@oc/shared';

/** Node name of an untranscribed recording segment (added to the editor in M3b). */
export const TRANSCRIPT_GAP_TYPE = 'transcriptGap';
/** What every exporter writes in place of a transcriptGap node. */
export const TRANSCRIPT_GAP_TEXT = '[未轉寫片段]';

const INLINE_TYPES = new Set(['text', 'hardBreak', TRANSCRIPT_GAP_TYPE]);

/** Whether a node's children are inline content (joined directly) rather than blocks. */
export function hasInlineChildren(node: JSONContent): boolean {
  return (node.content ?? []).some((child) => INLINE_TYPES.has(child.type ?? ''));
}

/**
 * Plain text of any node; exporters use it for nodes they do not know.
 * Inline children (text, hard breaks, gaps) are joined directly, block children with newlines.
 */
export function nodeText(node: JSONContent): string {
  if (node.type === 'hardBreak') return '\n';
  if (node.type === TRANSCRIPT_GAP_TYPE) return TRANSCRIPT_GAP_TEXT;
  if (typeof node.text === 'string') return node.text;
  const children = node.content ?? [];
  const inline = children.some((child) => INLINE_TYPES.has(child.type ?? ''));
  return children.map(nodeText).join(inline ? '' : '\n');
}

/** First number of an ordered list (Tiptap's `start` attribute, default 1, never below 0). */
export function listStart(list: JSONContent): number {
  const start = Number(list.attrs?.start ?? 1);
  return Number.isInteger(start) ? Math.max(start, 0) : 1;
}

/**
 * Puts a list marker in front of a list item's text and indents its following lines by the
 * marker's width, so nested lists and wrapped lines stay inside the item.
 */
export function formatListItem(marker: string, body: string): string {
  const indent = ' '.repeat(marker.length);
  return body
    .split('\n')
    .map((line, index) => {
      if (index === 0) return `${marker}${line}`.trimEnd();
      return line === '' ? '' : `${indent}${line}`;
    })
    .join('\n');
}

/** Link schemes exporters write out; anything else (e.g. `javascript:`) keeps only its text. */
const SAFE_LINK = /^(?:https?:|mailto:|tel:)/i;

/** The href of a text node's link mark when it is safe to write out, else undefined. */
export function linkHref(node: JSONContent): string | undefined {
  const href = node.marks?.find((mark) => mark.type === 'link')?.attrs?.href;
  if (typeof href !== 'string') return undefined;
  const trimmed = href.trim();
  return SAFE_LINK.test(trimmed) ? trimmed : undefined;
}

/**
 * Inline nodes split into runs: consecutive nodes with the same safe link href share a run, and so
 * do consecutive nodes outside any link.
 */
export function linkRuns(nodes: JSONContent[]): { href?: string; nodes: JSONContent[] }[] {
  const runs: { href?: string; nodes: JSONContent[] }[] = [];
  for (const node of nodes) {
    const href = node.type === 'text' ? linkHref(node) : undefined;
    const last = runs[runs.length - 1];
    if (last && last.href === href) last.nodes.push(node);
    else runs.push({ href, nodes: [node] });
  }
  return runs;
}

/** Whether a link's text already shows its address, so writing the href again would only repeat it. */
export function linkShowsHref(text: string, href: string): boolean {
  const shown = text.trim();
  const bare = href.replace(/^(?:mailto:|tel:)/i, '');
  return shown === href || shown === bare || `http://${shown}` === href || `https://${shown}` === href;
}
