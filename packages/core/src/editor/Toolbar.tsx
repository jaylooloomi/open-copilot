import { useEditorState, type Editor as TiptapEditor } from '@tiptap/react';
import {
  Baseline,
  Bold,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Redo2,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Underline,
  Undo2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { ColorPalette } from './ColorPalette';
import { HIGHLIGHT_COLORS, TEXT_COLORS } from './palettes';

type BlockStyle = 'paragraph' | 'h1' | 'h2' | 'h3';
type Align = 'left' | 'center' | 'right';

const BLOCK_OPTIONS: { value: BlockStyle; label: string }[] = [
  { value: 'paragraph', label: '正文' },
  { value: 'h1', label: '標題 1' },
  { value: 'h2', label: '標題 2' },
  { value: 'h3', label: '標題 3' },
];

const HEADING_LEVEL = { h1: 1, h2: 2, h3: 3 } as const;

const ICON_SIZE = 18;

function currentBlock(editor: TiptapEditor): BlockStyle {
  if (editor.isActive('heading', { level: 1 })) return 'h1';
  if (editor.isActive('heading', { level: 2 })) return 'h2';
  if (editor.isActive('heading', { level: 3 })) return 'h3';
  return 'paragraph';
}

function currentAlign(editor: TiptapEditor): Align {
  if (editor.isActive({ textAlign: 'center' })) return 'center';
  if (editor.isActive({ textAlign: 'right' })) return 'right';
  return 'left';
}

function ToolButton(props: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={props.active ? 'oc-tool is-active' : 'oc-tool'}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.active}
      disabled={props.disabled}
      // Keep the editor's selection while clicking toolbar buttons.
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function Toolbar({ editor }: { editor: TiptapEditor }) {
  const state = useEditorState({
    editor,
    // Read the prop, not the snapshot: after useEditor recreates the editor (note switch),
    // useEditorState keeps handing out the previous, destroyed editor until the next transaction.
    selector: () => ({
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
      block: currentBlock(editor),
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      color: editor.getAttributes('textStyle').color as string | undefined,
      highlight: editor.getAttributes('highlight').color as string | undefined,
      align: currentAlign(editor),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
    }),
  });

  const chain = () => editor.chain().focus();

  const setBlock = (value: BlockStyle) => {
    if (value === 'paragraph') chain().setParagraph().run();
    else chain().setHeading({ level: HEADING_LEVEL[value] }).run();
  };

  const setAlign = (align: Align) => chain().setTextAlign(align).run();

  return (
    <div className="oc-toolbar" role="toolbar" aria-label="格式工具列">
      <div className="oc-tool-group">
        <ToolButton label="復原" disabled={!state.canUndo} onClick={() => chain().undo().run()}>
          <Undo2 size={ICON_SIZE} />
        </ToolButton>
        <ToolButton label="重做" disabled={!state.canRedo} onClick={() => chain().redo().run()}>
          <Redo2 size={ICON_SIZE} />
        </ToolButton>
      </div>

      <div className="oc-tool-group">
        <select
          className="oc-block-select"
          aria-label="段落樣式"
          value={state.block}
          onChange={(event) => setBlock(event.target.value as BlockStyle)}
        >
          {BLOCK_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="oc-tool-group">
        <ToolButton label="粗體" active={state.bold} onClick={() => chain().toggleBold().run()}>
          <Bold size={ICON_SIZE} />
        </ToolButton>
        <ToolButton label="斜體" active={state.italic} onClick={() => chain().toggleItalic().run()}>
          <Italic size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="底線"
          active={state.underline}
          onClick={() => chain().toggleUnderline().run()}
        >
          <Underline size={ICON_SIZE} />
        </ToolButton>
        <ColorPalette
          label="字色"
          icon={<Baseline size={ICON_SIZE} />}
          colors={TEXT_COLORS}
          current={state.color}
          onPick={(color) => chain().setColor(color).run()}
          onClear={() => chain().unsetColor().run()}
        />
        <ColorPalette
          label="螢光筆"
          icon={<Highlighter size={ICON_SIZE} />}
          colors={HIGHLIGHT_COLORS}
          current={state.highlight}
          onPick={(color) => chain().setHighlight({ color }).run()}
          onClear={() => chain().unsetHighlight().run()}
        />
      </div>

      <div className="oc-tool-group">
        <ToolButton label="靠左" active={state.align === 'left'} onClick={() => setAlign('left')}>
          <TextAlignStart size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="置中"
          active={state.align === 'center'}
          onClick={() => setAlign('center')}
        >
          <TextAlignCenter size={ICON_SIZE} />
        </ToolButton>
        <ToolButton label="靠右" active={state.align === 'right'} onClick={() => setAlign('right')}>
          <TextAlignEnd size={ICON_SIZE} />
        </ToolButton>
      </div>

      <div className="oc-tool-group">
        <ToolButton
          label="項目清單"
          active={state.bulletList}
          onClick={() => chain().toggleBulletList().run()}
        >
          <List size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="編號清單"
          active={state.orderedList}
          onClick={() => chain().toggleOrderedList().run()}
        >
          <ListOrdered size={ICON_SIZE} />
        </ToolButton>
      </div>
    </div>
  );
}
