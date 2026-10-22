import type { Node as PmNode } from '@tiptap/pm/model';
import { Selection, type Transaction } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import { TRANSCRIPT_GAP_TYPE } from '../export/common';

/**
 * Inserts transcripts at the position the cursor had when recording started. The position is
 * mapped through every document change, so typing elsewhere while recording never shifts it, and
 * the user's own selection is left alone.
 */
export class TranscriptInserter {
  private pos: number;
  private destroyed = false;

  constructor(
    private readonly editor: Editor,
    anchorPos: number,
  ) {
    this.pos = textPosition(editor, anchorPos);
    editor.on('transaction', this.onTransaction);
  }

  get position(): number {
    return this.pos;
  }

  insertText(text: string): void {
    if (text === '') return;
    // schema.text() carries no marks, so a transcript is plain even inside bold text.
    this.insert(this.editor.schema.text(text));
  }

  insertGap(gapId: string, seq: number): void {
    this.insert(this.editor.schema.nodes[TRANSCRIPT_GAP_TYPE].create({ gapId, seq }));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.editor.off('transaction', this.onTransaction);
  }

  private readonly onTransaction = ({
    transaction,
    appendedTransactions = [],
  }: {
    transaction: Transaction;
    appendedTransactions?: Transaction[];
  }) => {
    // assoc = 1: content inserted exactly at the anchor ends up before it, so our own
    // insertions (and the user typing at the same spot) push the anchor forward.
    for (const tr of [transaction, ...appendedTransactions]) {
      if (tr.docChanged) this.pos = tr.mapping.map(this.pos, 1);
    }
  };

  private insert(node: PmNode): void {
    if (this.destroyed || this.editor.isDestroyed) return;
    const { state, view } = this.editor;
    view.dispatch(state.tr.insert(this.pos, node));
  }
}

/** Clamps pos into the document and moves it into a textblock (e.g. after a select-all). */
function textPosition(editor: Editor, pos: number): number {
  const { doc } = editor.state;
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  return $pos.parent.inlineContent ? $pos.pos : Selection.near($pos, -1).from;
}
