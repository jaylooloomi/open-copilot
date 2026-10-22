import type { JSONContent, Note } from '@oc/shared';
import {
  formatListItem,
  hasInlineChildren,
  linkRuns,
  linkShowsHref,
  listStart,
  nodeText,
} from './common';

/**
 * Plain text: the title, a blank line, then one line per paragraph or list item.
 * Lists keep their `- ` / `1. ` markers and links become `text (href)`; every other kind of
 * formatting is dropped.
 */
export function toTxt(note: Note): string {
  const title = note.title.trim();
  const body = (note.content.content ?? [])
    .map(renderBlock)
    .join('\n')
    // Drop blank lines at both ends (e.g. the empty paragraph Tiptap keeps after a final list).
    .replace(/^\n+|\n+$/g, '');
  return [title, body].filter((part) => part !== '').join('\n\n');
}

function renderBlock(node: JSONContent): string {
  switch (node.type) {
    case 'bulletList':
    case 'orderedList':
      return renderList(node);
    default:
      // Paragraphs, headings and unknown blocks are their text content, with link addresses kept.
      if (typeof node.text === 'string' || !node.content?.length) return nodeText(node);
      if (hasInlineChildren(node)) return inlineText(node.content);
      return node.content.map(renderBlock).join('\n');
  }
}

function inlineText(nodes: JSONContent[]): string {
  return linkRuns(nodes)
    .map(({ href, nodes: run }) => {
      const text = run.map(nodeText).join('');
      return href && text.trim() !== '' && !linkShowsHref(text, href) ? `${text} (${href})` : text;
    })
    .join('');
}

function renderList(list: JSONContent): string {
  const ordered = list.type === 'orderedList';
  const start = listStart(list);
  return (list.content ?? [])
    .map((item, index) => {
      const marker = ordered ? `${start + index}. ` : '- ';
      const body = (item.content ?? []).map(renderBlock).join('\n');
      return formatListItem(marker, body);
    })
    .join('\n');
}
