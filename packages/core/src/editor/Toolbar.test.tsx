import type { Editor as TiptapEditor } from '@tiptap/react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Editor } from './Editor';
import { Toolbar } from './Toolbar';
import { useNoteEditor } from './useNoteEditor';

function Harness({ editorRef }: { editorRef: { current: TiptapEditor | null } }) {
  const editor = useNoteEditor({
    noteId: 'n1',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
    },
    onChange: () => undefined,
  });
  editorRef.current = editor;
  return (
    <>
      <Toolbar editor={editor} />
      <Editor editor={editor} />
    </>
  );
}

function setup() {
  const editorRef = { current: null as TiptapEditor | null };
  render(<Harness editorRef={editorRef} />);
  const editor = editorRef.current as TiptapEditor;
  // Select "Hello world" (positions 1..12 inside the first paragraph).
  act(() => {
    editor.commands.setTextSelection({ from: 1, to: 12 });
  });
  return { editor, user: userEvent.setup() };
}

const button = (name: string) => screen.getByRole('button', { name });

describe('Toolbar', () => {
  it('renders every M1 control and no copy/export buttons', () => {
    setup();
    expect(screen.getByRole('toolbar', { name: '格式工具列' })).toBeInTheDocument();
    for (const name of [
      '復原', '重做', '粗體', '斜體', '底線', '字色', '螢光筆',
      '靠左', '置中', '靠右', '項目清單', '編號清單',
    ]) {
      expect(button(name)).toBeInTheDocument();
    }
    expect(screen.getByRole('combobox', { name: '段落樣式' })).toHaveValue('paragraph');
    expect(screen.queryByRole('button', { name: /複製|匯出/ })).not.toBeInTheDocument();
  });

  it('toggles bold, italic and underline and reflects the state', async () => {
    const { editor, user } = setup();
    await user.click(button('粗體'));
    await user.click(button('斜體'));
    await user.click(button('底線'));

    expect(editor.isActive('bold')).toBe(true);
    expect(editor.isActive('italic')).toBe(true);
    expect(editor.isActive('underline')).toBe(true);
    expect(button('粗體')).toHaveAttribute('aria-pressed', 'true');

    await user.click(button('粗體'));
    expect(editor.isActive('bold')).toBe(false);
    expect(button('粗體')).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches the block style between 正文 and 標題 1-3', async () => {
    const { editor, user } = setup();
    const select = screen.getByRole('combobox', { name: '段落樣式' });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '正文', '標題 1', '標題 2', '標題 3',
    ]);

    await user.selectOptions(select, '標題 2');
    expect(editor.isActive('heading', { level: 2 })).toBe(true);
    expect(select).toHaveValue('h2');

    await user.selectOptions(select, '正文');
    expect(editor.isActive('paragraph')).toBe(true);
    expect(select).toHaveValue('paragraph');
  });

  it('applies and clears text colour from the palette', async () => {
    const { editor, user } = setup();
    await user.click(button('字色'));
    await user.click(button('紅色'));
    expect(editor.getAttributes('textStyle').color).toBe('#dc2626');

    await user.click(button('字色'));
    await user.click(button('清除'));
    expect(editor.getAttributes('textStyle').color).toBeUndefined();
  });

  it('applies and clears highlight from the palette', async () => {
    const { editor, user } = setup();
    await user.click(button('螢光筆'));
    await user.click(button('黃色'));
    expect(editor.getAttributes('highlight').color).toBe('#fef08a');

    await user.click(button('螢光筆'));
    await user.click(button('清除'));
    expect(editor.isActive('highlight')).toBe(false);
  });

  it('aligns left, center and right', async () => {
    const { editor, user } = setup();
    expect(button('靠左')).toHaveAttribute('aria-pressed', 'true');

    await user.click(button('置中'));
    expect(editor.isActive({ textAlign: 'center' })).toBe(true);
    expect(button('置中')).toHaveAttribute('aria-pressed', 'true');

    await user.click(button('靠右'));
    expect(editor.isActive({ textAlign: 'right' })).toBe(true);

    await user.click(button('靠左'));
    expect(editor.isActive({ textAlign: 'left' })).toBe(true);
  });

  it('toggles bullet and ordered lists', async () => {
    const { editor, user } = setup();
    await user.click(button('項目清單'));
    expect(editor.isActive('bulletList')).toBe(true);
    expect(button('項目清單')).toHaveAttribute('aria-pressed', 'true');

    await user.click(button('編號清單'));
    expect(editor.isActive('orderedList')).toBe(true);
    expect(editor.isActive('bulletList')).toBe(false);
  });

  it('enables undo/redo only when there is history', async () => {
    const { editor, user } = setup();
    expect(button('復原')).toBeDisabled();
    expect(button('重做')).toBeDisabled();

    await user.click(button('粗體'));
    expect(button('復原')).toBeEnabled();

    await user.click(button('復原'));
    expect(editor.isActive('bold')).toBe(false);
    expect(button('重做')).toBeEnabled();

    await user.click(button('重做'));
    expect(editor.isActive('bold')).toBe(true);
  });
});
