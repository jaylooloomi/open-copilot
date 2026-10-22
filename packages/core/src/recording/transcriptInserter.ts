import type { Node as PmNode } from "@tiptap/pm/model";
import {
  type EditorState,
  Selection,
  type Transaction,
} from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { TRANSCRIPT_GAP_TEXT, TRANSCRIPT_GAP_TYPE } from "../export/common";

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
    editor.on("transaction", this.onTransaction);
  }

  get position(): number {
    return this.pos;
  }

  insertText(text: string): void {
    if (text === "") return;
    // schema.text() carries no marks, so a transcript is plain even inside bold text.
    this.insert(this.editor.schema.text(text));
  }

  insertGap(gapId: string, seq: number): void {
    this.insert(
      this.editor.schema.nodes[TRANSCRIPT_GAP_TYPE].create({ gapId, seq }),
    );
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.editor.off("transaction", this.onTransaction);
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
    // Edits made while recording (e.g. deleting the anchor's paragraph) can map the anchor out of
    // any textblock, so normalize it on every insert to keep consecutive transcripts together.
    const pos = textPosition(this.editor, this.pos);
    const $pos = state.doc.resolve(pos);
    if ($pos.parent.canReplaceWith($pos.index(), $pos.index(), node.type)) {
      // Mapped with assoc = 1 in onTransaction, so the anchor ends up right after the node.
      this.pos = pos;
      view.dispatch(this.background(state.tr.insert(pos, node), state));
      return;
    }
    // The textblock does not accept this node (a gap inside a code block). Never split the
    // user's block: put the node in a new paragraph right after it and continue from there.
    // At document level (no textblock anywhere to anchor in) insert the paragraph right here.
    const after = $pos.depth > 0 ? $pos.after() : pos;
    const paragraph = state.schema.nodes.paragraph?.createAndFill(null, node);
    const $after = state.doc.resolve(after);
    if (
      paragraph &&
      $after.parent.canReplaceWith(
        $after.index(),
        $after.index(),
        paragraph.type,
      )
    ) {
      this.pos = after;
      view.dispatch(this.background(state.tr.insert(after, paragraph), state));
      // The anchor is mapped to just past the new paragraph; pull it back to the paragraph's end
      // so the next transcript continues right after the node.
      this.pos = textPosition(this.editor, this.pos);
      return;
    }
    // Last resort: the plain-text placeholder fits wherever text does. schema.text() keeps it
    // plain, unlike tr.insertText(), which takes the marks at pos.
    this.pos = pos;
    view.dispatch(
      this.background(
        state.tr.insert(pos, state.schema.text(TRANSCRIPT_GAP_TEXT)),
        state,
      ),
    );
  }

  /**
   * A transcript arrives in the background, so it must not disturb the user's editing: keep the
   * marks they turned on at the cursor (any doc change clears stored marks) and keep it out of the
   * undo history, so Ctrl+Z never removes transcript text or groups it with the user's typing.
   */
  private background(tr: Transaction, state: EditorState): Transaction {
    if (state.storedMarks) tr.setStoredMarks(state.storedMarks);
    return tr.setMeta("addToHistory", false);
  }
}

/**
 * Clamps pos into the document and moves it into a textblock (e.g. after a select-all). Only text
 * positions are searched: Selection.near() may return a NodeSelection on an atom block such as a
 * horizontal rule, whose position is still at document level.
 */
function textPosition(editor: Editor, pos: number): number {
  const { doc } = editor.state;
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  if ($pos.parent.inlineContent) return $pos.pos;
  const found =
    Selection.findFrom($pos, -1, true) ?? Selection.findFrom($pos, 1, true);
  return found ? found.from : $pos.pos;
}
