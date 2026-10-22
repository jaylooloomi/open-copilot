import type { JSONContent } from '@oc/shared';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { act, render, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Editor } from './Editor';
import { useNoteEditor } from './useNoteEditor';

const doc = (text?: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }],
});

function Harness(props: {
  noteId: string;
  content: JSONContent;
  onChange: (content: JSONContent) => void;
  editorRef?: { current: TiptapEditor | null };
}) {
  const editor = useNoteEditor({
    noteId: props.noteId,
    content: props.content,
    onChange: props.onChange,
  });
  if (props.editorRef) props.editorRef.current = editor;
  return <Editor editor={editor} />;
}

describe('Editor + useNoteEditor', () => {
  it('renders the note content in a labelled textbox', () => {
    render(<Harness noteId="a" content={doc('Hello')} onChange={vi.fn()} />);
    const box = screen.getByRole('textbox', { name: '筆記內文' });
    expect(box).toHaveTextContent('Hello');
  });

  it('shows the placeholder for an empty note', () => {
    render(<Harness noteId="a" content={doc()} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: '筆記內文' }).querySelector('p')).toHaveAttribute(
      'data-placeholder',
      '在這裡開始編寫筆記..',
    );
  });

  it('reports edits as Tiptap JSON', () => {
    const onChange = vi.fn();
    const editorRef = { current: null as TiptapEditor | null };
    render(<Harness noteId="a" content={doc('Hello')} onChange={onChange} editorRef={editorRef} />);

    act(() => {
      editorRef.current?.chain().setTextSelection(6).insertContent('!').run();
    });

    expect(onChange).toHaveBeenLastCalledWith({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: null },
          content: [{ type: 'text', text: 'Hello!' }],
        },
      ],
    });
  });

  it('loads the new note and starts a fresh undo history when noteId changes', () => {
    const editorRef = { current: null as TiptapEditor | null };
    const { rerender } = render(
      <Harness noteId="a" content={doc('First')} onChange={vi.fn()} editorRef={editorRef} />,
    );
    act(() => {
      editorRef.current?.commands.insertContent('x');
    });

    rerender(<Harness noteId="b" content={doc('Second')} onChange={vi.fn()} editorRef={editorRef} />);

    expect(screen.getByRole('textbox', { name: '筆記內文' })).toHaveTextContent('Second');
    expect(editorRef.current?.can().undo()).toBe(false);
  });

  it('never reports the previous note content to the new note while switching', () => {
    const editors: TiptapEditor[] = [];
    let lateWriteText: string | undefined;
    // Mutates the editor from a layout effect: after the commit that carries the new noteId
    // but before useEditor's passive effect replaces the old editor instance.
    function LateWriter(props: {
      noteId: string;
      content: JSONContent;
      onChange: (content: JSONContent) => void;
    }) {
      const editor = useNoteEditor(props);
      if (!editors.includes(editor)) editors.push(editor);
      useLayoutEffect(() => {
        if (props.noteId === 'b' && editor === editors[0] && !editor.isDestroyed) {
          editor.commands.insertContent('late ');
          lateWriteText = editor.getText();
        }
      });
      return <Editor editor={editor} />;
    }

    const onChangeA = vi.fn();
    const onChangeB = vi.fn();
    const { rerender } = render(
      <LateWriter noteId="a" content={doc('Note A')} onChange={onChangeA} />,
    );
    rerender(<LateWriter noteId="b" content={doc('Note B')} onChange={onChangeB} />);

    // The late write really hit the old editor inside the switch window.
    expect(lateWriteText).toBe('late Note A');
    expect(onChangeB).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '筆記內文' })).toHaveTextContent('Note B');

    // Edits to the new note's own editor still reach its onChange.
    act(() => {
      editors.at(-1)?.chain().setTextSelection(7).insertContent('!').run();
    });
    expect(onChangeB).toHaveBeenCalledTimes(1);
    expect(onChangeB).toHaveBeenLastCalledWith({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: null },
          content: [{ type: 'text', text: 'Note B!' }],
        },
      ],
    });
  });

  it('ignores content prop changes for the same note (no reset while typing)', () => {
    const { rerender } = render(<Harness noteId="a" content={doc('Typed')} onChange={vi.fn()} />);
    rerender(<Harness noteId="a" content={doc('Stale')} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: '筆記內文' })).toHaveTextContent('Typed');
  });
});
