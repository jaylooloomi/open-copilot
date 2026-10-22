import type { JSONContent } from '@oc/shared';
import { useEditor, type Editor as TiptapEditor } from '@tiptap/react';
import { useMemo, useRef } from 'react';
import { createExtensions } from './extensions';

export interface UseNoteEditorOptions {
  /** The editor is recreated (fresh content + undo history) whenever this changes. */
  noteId: string | undefined;
  /** Initial content; later changes for the same noteId are ignored. */
  content: JSONContent;
  onChange(content: JSONContent): void;
}

export function useNoteEditor({ noteId, content, onChange }: UseNoteEditorOptions): TiptapEditor {
  const extensions = useMemo(() => createExtensions(), []);
  // The note each editor instance was created for. useEditor only replaces the editor in a
  // passive effect after a noteId change, while it already routes onUpdate to the newest
  // options, so for a moment the old note's editor would report into the new note's onChange.
  const owners = useRef(new WeakMap<TiptapEditor, string | undefined>());
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
        owners.current.set(editor, noteId);
      },
      // useEditor always calls the latest onUpdate; drop updates from an editor that belongs
      // to a note other than the current one.
      onUpdate: ({ editor }) => {
        if (owners.current.get(editor) === noteId) onChange(editor.getJSON());
      },
    },
    [noteId],
  );
}
