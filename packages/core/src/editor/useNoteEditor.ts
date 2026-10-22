import type { JSONContent } from '@oc/shared';
import type { Node as PmNode } from '@tiptap/pm/model';
import { useEditor, type Editor as TiptapEditor } from '@tiptap/react';
import { useMemo, useState } from 'react';
import { createExtensions } from './extensions';

export interface UseNoteEditorOptions {
  /** The editor is recreated (fresh content + undo history) whenever this changes. */
  noteId: string | undefined;
  /**
   * Bump to recreate the editor for the same note, e.g. after an import replaced the note's
   * content. Defaults to 0.
   */
  revision?: number;
  /** Initial content; later changes for the same noteId and revision are ignored. */
  content: JSONContent;
  /**
   * Called with the whole document after each edit, and the id of the note the editor was
   * created for. Route the change by that id (`useNotes.updateNote(noteId, ...)`), not by an
   * "active note" state: the active note can move before React re-renders (an async create or
   * rollback) while the old note's editor is still mounted. Never called while `noteId` is
   * undefined.
   */
  onChange(content: JSONContent, noteId: string): void;
}

/**
 * Creates the Tiptap editor for one note. The returned editor is never null while the
 * component stays mounted; inside `<Activity mode="hidden">` or a hidden Suspense subtree
 * Tiptap may destroy it, so this hook is not meant for those.
 */
export function useNoteEditor({ noteId, revision = 0, content, onChange }: UseNoteEditorOptions): TiptapEditor {
  const extensions = useMemo(() => createExtensions(), []);
  // The note each editor instance was created for. useEditor only replaces the editor in a
  // passive effect after a noteId change, while it already routes onUpdate to the newest
  // options, so for a moment the old note's editor would report into the new note's onChange.
  const [owners] = useState(() => new WeakMap<TiptapEditor, string | undefined>());
  return useEditor(
    {
      immediatelyRender: true,
      extensions,
      content,
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': '筆記內文',
          class: 'oc-prose',
        },
      },
      // Runs synchronously in the Editor constructor with the options of the render that
      // created it, so it tags the instance with that render's noteId.
      onBeforeCreate: ({ editor }) => {
        owners.set(editor, noteId);
      },
      // useEditor always calls the latest onUpdate; drop updates from an editor that belongs
      // to a note other than the current one.
      onUpdate: ({ editor, transaction, appendedTransactions }) => {
        if (!transaction.docChanged) {
          // Only plugins (appendTransaction) changed the doc. Not an edit when all they did was
          // StarterKit's TrailingNode appending an empty paragraph to a note that ends in a list,
          // heading or quote, which happens on any transaction, even a click that only moves the
          // selection; that paragraph is saved with the next real edit. Any other plugin edit
          // is reported.
          if (!appendedTransactions.some((tr) => tr.docChanged)) return;
          if (onlyAddsEmptyParagraph(transaction.doc, editor.state.doc)) return;
        }
        // No note, no owner to report to.
        const owner = owners.get(editor);
        if (noteId !== undefined && owner === noteId) onChange(editor.getJSON(), owner);
      },
    },
    [noteId, revision],
  );
}

/** True when `after` is `before` plus one empty paragraph at the end (TrailingNode's edit). */
function onlyAddsEmptyParagraph(before: PmNode, after: PmNode): boolean {
  if (after.childCount !== before.childCount + 1) return false;
  const last = after.lastChild;
  if (!last || last.type.name !== 'paragraph' || last.content.size !== 0) return false;
  for (let i = 0; i < before.childCount; i += 1) {
    if (!after.child(i).eq(before.child(i))) return false;
  }
  return true;
}
