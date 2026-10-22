import type { JSONContent } from '@oc/shared';

/** Node name of an untranscribed recording segment (added to the editor in M3b). */
export const TRANSCRIPT_GAP_TYPE = 'transcriptGap';
/** What every exporter writes in place of a transcriptGap node. */
export const TRANSCRIPT_GAP_TEXT = '[未轉寫片段]';

const INLINE_TYPES = new Set(['text', 'hardBreak', TRANSCRIPT_GAP_TYPE]);

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

/** First number of an ordered list (Tiptap's `start` attribute, default 1). */
export function listStart(list: JSONContent): number {
  const start = Number(list.attrs?.start ?? 1);
  return Number.isInteger(start) ? start : 1;
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
