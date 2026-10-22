import type { JSONContent } from '@oc/shared';
import { useEditor, type Editor as TiptapEditor } from '@tiptap/react';
import { useMemo, useState } from 'react';
import { createExtensions } from './extensions';

export interface UseNoteEditorOptions {
  /** The editor is recreated (fresh content + undo history) whenever this changes. */
  noteId: string | undefined;
  /** Initial content; later changes for the same noteId are ignored. */
  content: JSONContent;
  /**
   * Called with the whole document after each edit of the note given by the current render's
   * `noteId`. It does not say which note changed: a consumer that routes the change by its own
   * "active note" state (such as `useNotes.updateActive`) must keep that state in step with the
   * rendered `noteId`. If the active note moves before React re-renders (an async rollback or
   * create), an edit typed into the still-mounted editor in that gap goes to the new active note.
   * Never called while `noteId` is undefined.
   */
  onChange(content: JSONContent): void;
}

/**
 * Creates the Tiptap editor for one note. The returned editor is never null while the
 * component stays mounted; inside `<Activity mode="hidden">` or a hidden Suspense subtree
 * Tiptap may destroy it, so this hook is not meant for those.
 */
export function useNoteEditor({ noteId, content, onChange }: UseNoteEditorOptions): TiptapEditor {
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
      onUpdate: ({ editor, transaction }) => {
        // Not an edit: StarterKit's TrailingNode appends an empty paragraph to a note that ends
        // in a list, heading or quote on any transaction, even a click that only moves the
        // selection. The paragraph is saved with the next real edit.
        // Tiptap emits 'update' when any transaction of the batch changed the doc but passes only
        // the root one, so this check assumes no extension makes a real edit through
        // appendTransaction alone (none in createExtensions does); such an edit would be dropped.
        if (!transaction.docChanged) return;
        // No note, no owner to report to.
        if (noteId !== undefined && owners.get(editor) === noteId) onChange(editor.getJSON());
      },
    },
    [noteId],
  );
}
