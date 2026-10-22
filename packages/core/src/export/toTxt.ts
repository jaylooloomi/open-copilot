import type { JSONContent, Note } from '@oc/shared';
import { formatListItem, listStart, nodeText } from './common';

/**
 * Plain text: the title, a blank line, then one line per paragraph or list item.
 * Lists keep their `- ` / `1. ` markers; every other kind of formatting is dropped.
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
      // Paragraphs and headings are their inline text; unknown blocks are their text content.
      return nodeText(node);
  }
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
