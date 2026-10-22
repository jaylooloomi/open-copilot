import type { JSONContent } from '@oc/shared';
import type { Editor } from '@tiptap/react';

/** Heading placed above the inserted task list. */
export const TODO_HEADING = '待辦事項';

/** One row of the 待辦事項 panel: the item text and whether the user ticked it. */
export interface TodoItem {
  text: string;
  checked: boolean;
}

const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });

/** The summary's non-blank lines, trimmed: one paragraph each in the panel and in the note. */
export function summaryLines(summary: string): string[] {
  return summary
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * Inserts the summary at the very start of the note (one undo step); false when nothing was inserted.
 * A blank note (one empty paragraph) is replaced rather than left below the summary.
 */
export function insertSummaryAtStart(editor: Editor, summary: string): boolean {
  const lines = summaryLines(summary);
  if (lines.length === 0 || editor.isDestroyed) return false;
  const { doc } = editor.state;
  const only = doc.childCount === 1 ? doc.firstChild : null;
  const blank = only !== null && only.type.name === 'paragraph' && only.content.size === 0;
  const range = blank ? { from: 0, to: doc.content.size } : 0;
  return editor.chain().insertContentAt(range, lines.map(paragraph)).run();
}

/**
 * Inserts a 待辦事項 heading and a task list with the items at the end of the note (one undo step).
 * An empty paragraph at the end of the note is replaced rather than left above the heading.
 * Items without text are skipped; false when nothing was inserted.
 */
export function insertTodosAtEnd(editor: Editor, items: TodoItem[]): boolean {
  const kept = items
    .map(({ text, checked }) => ({ text: text.trim(), checked }))
    .filter(({ text }) => text !== '');
  if (kept.length === 0 || editor.isDestroyed) return false;
  const blocks: JSONContent[] = [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: TODO_HEADING }] },
    {
      type: 'taskList',
      content: kept.map(({ text, checked }) => ({ type: 'taskItem', attrs: { checked }, content: [paragraph(text)] })),
    },
  ];
  const { doc } = editor.state;
  const end = doc.content.size;
  const last = doc.lastChild;
  let range: number | { from: number; to: number } = end;
  if (last && last.type.name === 'paragraph' && last.content.size === 0) {
    range = { from: end - last.nodeSize, to: end };
  }
  return editor.chain().insertContentAt(range, blocks).run();
}
