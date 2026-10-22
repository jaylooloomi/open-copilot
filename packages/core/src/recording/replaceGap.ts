import type { Editor } from '@tiptap/react';
import { TRANSCRIPT_GAP_TYPE } from '../export/common';

/**
 * Replaces the transcriptGap node with this gapId by `text` (or removes it when text is empty).
 * Returns false when the document has no such gap.
 */
export function replaceGap(editor: Editor, gapId: string, text: string): boolean {
  if (editor.isDestroyed) return false;
  let range: { from: number; to: number } | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (range) return false;
    if (node.type.name === TRANSCRIPT_GAP_TYPE && node.attrs.gapId === gapId) {
      range = { from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  if (!range) return false;
  const tr = editor.state.tr;
  if (text) tr.replaceWith(range.from, range.to, editor.schema.text(text));
  else tr.delete(range.from, range.to);
  editor.view.dispatch(tr);
  return true;
}
