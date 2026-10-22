import type { Mark } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { TRANSCRIPT_GAP_TYPE } from '../export/common';

/**
 * Replaces the transcriptGap node with this gapId by `text` (or removes it when text is empty).
 * The text keeps the marks the gap carried (e.g. a bolded gap), and line breaks become spaces
 * because a transcript is inserted as one inline run. Returns false when the document has no such gap.
 */
export function replaceGap(editor: Editor, gapId: string, text: string): boolean {
  if (editor.isDestroyed) return false;
  let range: { from: number; to: number; marks: readonly Mark[] } | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (range) return false;
    if (node.type.name === TRANSCRIPT_GAP_TYPE && node.attrs.gapId === gapId) {
      range = { from: pos, to: pos + node.nodeSize, marks: node.marks };
      return false;
    }
    return true;
  });
  if (!range) return false;
  const tr = editor.state.tr;
  const line = text.replace(/[\r\n]+/g, ' ');
  if (line) tr.replaceWith(range.from, range.to, editor.schema.text(line, range.marks));
  else tr.delete(range.from, range.to);
  editor.view.dispatch(tr);
  return true;
}
