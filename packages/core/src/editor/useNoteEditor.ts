import type { JSONContent } from '@oc/shared';
import { useEditor, type Editor as TiptapEditor } from '@tiptap/react';
import { useMemo } from 'react';
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
      // useEditor always calls the latest onUpdate, so a fresh closure per render is fine.
      onUpdate: ({ editor }) => onChange(editor.getJSON()),
    },
    [noteId],
  );
}
