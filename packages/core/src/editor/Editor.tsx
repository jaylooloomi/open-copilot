import { EditorContent, type Editor as TiptapEditor } from '@tiptap/react';

export function Editor({ editor }: { editor: TiptapEditor }) {
  return <EditorContent editor={editor} className="oc-editor" />;
}
