import type { Mark } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { TRANSCRIPT_GAP_TYPE } from '../export/common';
import { transcriptLine } from './transcriptInserter';

/**
 * Replaces the transcriptGap node with this gapId by `text` (or removes it when text is empty).
 * The text keeps the marks the gap carried (e.g. a bolded gap), and line breaks become spaces
 * because a transcript is inserted as one inline run. Like TranscriptInserter, the replacement stays
 * out of the undo history and keeps the marks the user turned on at the cursor: otherwise the next
 * Ctrl+Z (meant for the user's own typing) would bring back a marker whose audio is no longer needed.
 * Returns false when the document has no such gap.
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
  const { state } = editor;
  const tr = state.tr;
  const line = transcriptLine(text);
  if (line) tr.replaceWith(range.from, range.to, editor.schema.text(line, range.marks));
  else tr.delete(range.from, range.to);
  if (state.storedMarks) tr.setStoredMarks(state.storedMarks);
  editor.view.dispatch(tr.setMeta('addToHistory', false));
  return true;
}
