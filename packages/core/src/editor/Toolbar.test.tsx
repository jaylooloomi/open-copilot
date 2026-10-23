import type { JSONContent, Note } from '@oc/shared';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PlatformProvider } from '../platform/PlatformContext';
import { createTestPlatform } from '../test/memoryStorage';
import { Editor } from './Editor';
import { Toolbar } from './Toolbar';
import { useNoteEditor } from './useNoteEditor';

const HELLO_DOC: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
};
const NOTE: Note = { id: 'n1', title: '測試', content: HELLO_DOC, createdAt: 1, updatedAt: 1 };

function Harness({
  editorRef,
  content,
}: {
  editorRef: { current: TiptapEditor | null };
  content: JSONContent;
}) {
  const editor = useNoteEditor({ noteId: NOTE.id, content, onChange: () => undefined });
  editorRef.current = editor;
  return (
    <>
      <Toolbar editor={editor} note={NOTE} />
      <Editor editor={editor} />
    </>
  );
}

function setup(content: JSONContent = HELLO_DOC, selection = { from: 1, to: 12 }) {
  const editorRef = { current: null as TiptapEditor | null };
  const { platform } = createTestPlatform();
  render(
    <PlatformProvider platform={platform}>
      <Harness editorRef={editorRef} content={content} />
    </PlatformProvider>,
  );
  const editor = editorRef.current as TiptapEditor;
  // By default select "Hello world" (positions 1..12 inside the first paragraph).
  act(() => {
    editor.commands.setTextSelection(selection);
  });
  return { editor, user: userEvent.setup() };
}

const button = (name: string) => screen.getByRole('button', { name });

const paragraph = (text: string, attrs?: Record<string, unknown>): JSONContent => ({
  type: 'paragraph',
  ...(attrs ? { attrs } : {}),
  content: [{ type: 'text', text }],
});

/** Resolves after the next animation frame, when Tiptap's `focus()` command moves focus. */
const nextFrame = () =>
  act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

const pressedAligns = () =>
  ['靠左', '置中', '靠右'].filter((name) => button(name).getAttribute('aria-pressed') === 'true');

describe('Toolbar', () => {
  it('renders every formatting control, then 複製 and 匯出 at the end', () => {
    setup();
    const toolbar = screen.getByRole('toolbar', { name: '格式工具列' });
    for (const name of [
      '復原', '重做', '粗體', '斜體', '底線', '字色', '螢光筆',
      '靠左', '置中', '靠右', '項目清單', '編號清單',
    ]) {
      expect(button(name)).toBeInTheDocument();
    }
    expect(screen.getByRole('combobox', { name: '段落樣式' })).toHaveValue('paragraph');
    const buttons = within(toolbar).getAllByRole('button');
    expect(buttons.slice(-2).map((b) => b.textContent)).toEqual(['複製', '匯出']);
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
    // A pointer pick hands focus back to the editor so the user can keep typing.
    await waitFor(() => expect(editor.isFocused).toBe(true));
  });

  it('keeps focus on the block style select when it is changed from the keyboard', async () => {
    const { editor } = setup();
    const select = screen.getByRole('combobox', { name: '段落樣式' });
    act(() => select.focus());

    // Chromium on Windows fires `change` as soon as ArrowDown moves a closed <select>.
    for (const value of ['h1', 'h2', 'h3']) {
      fireEvent.keyDown(select, { key: 'ArrowDown' });
      fireEvent.change(select, { target: { value } });
      await nextFrame();
      expect(select).toHaveFocus();
    }

    expect(editor.isActive('heading', { level: 3 })).toBe(true);
    // The style lands on the paragraph that was selected before the select took focus.
    expect(editor.state.doc.firstChild?.textContent).toBe('Hello world');
    expect(select).toHaveValue('h3');
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

  it('presses no alignment button for justified text or a mixed-alignment selection', async () => {
    // Doc positions: "Left" 1..5, "Centred" 7..14, "Justified" 16..25.
    const { editor, user } = setup(
      {
        type: 'doc',
        content: [
          paragraph('Left'),
          paragraph('Centred', { textAlign: 'center' }),
          paragraph('Justified', { textAlign: 'justify' }),
        ],
      },
      { from: 2, to: 3 },
    );
    expect(pressedAligns()).toEqual(['靠左']);

    // TextAlign also allows 'justify' (Mod-Shift-J or pasted HTML); the toolbar has no button for it.
    act(() => {
      editor.commands.setTextSelection(18);
    });
    expect(pressedAligns()).toEqual([]);

    act(() => {
      editor.commands.setTextSelection({ from: 2, to: 9 });
    });
    expect(pressedAligns()).toEqual([]);

    act(() => {
      editor.commands.setTextSelection({ from: 8, to: 9 });
    });
    expect(pressedAligns()).toEqual(['置中']);

    act(() => {
      editor.commands.setTextSelection(18);
    });
    await user.click(button('靠左'));
    expect(editor.isActive({ textAlign: 'left' })).toBe(true);
    expect(pressedAligns()).toEqual(['靠左']);
  });

  it('reflects the formatting under a selection moved inside the editor', () => {
    // Doc positions: "Bold" 1..5, " plain" 5..11, "Centred" 13..20.
    const { editor } = setup(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
              { type: 'text', text: ' plain' },
            ],
          },
          paragraph('Centred', { textAlign: 'center' }),
        ],
      },
      { from: 7, to: 9 },
    );
    expect(button('粗體')).toHaveAttribute('aria-pressed', 'false');
    expect(pressedAligns()).toEqual(['靠左']);

    act(() => {
      editor.commands.setTextSelection(3);
    });
    expect(button('粗體')).toHaveAttribute('aria-pressed', 'true');
    expect(pressedAligns()).toEqual(['靠左']);

    act(() => {
      editor.commands.setTextSelection(16);
    });
    expect(button('粗體')).toHaveAttribute('aria-pressed', 'false');
    expect(pressedAligns()).toEqual(['置中']);
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
