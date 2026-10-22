import { Extension, type Extensions } from '@tiptap/react';
import { Highlight } from '@tiptap/extension-highlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TextAlign } from '@tiptap/extension-text-align';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import { Placeholder } from '@tiptap/extensions';
import { StarterKit } from '@tiptap/starter-kit';
import { TranscriptGap } from './transcriptGap';

export const EDITOR_PLACEHOLDER = '在這裡開始編寫筆記..';

/**
 * Undo/redo keys always count as handled. ProseMirror's undo/redo commands return false when there
 * is nothing to undo or redo, and the browser then runs its own contenteditable undo, which edits
 * the document behind ProseMirror's history (e.g. Ctrl+Shift+Z deleting the last typed words).
 */
const HistoryKeys = Extension.create({
  name: 'historyKeys',
  addKeyboardShortcuts() {
    const undo = () => {
      this.editor.commands.undo();
      return true;
    };
    const redo = () => {
      this.editor.commands.redo();
      return true;
    };
    return { 'Mod-z': undo, 'Mod-Z': undo, 'Mod-Shift-z': redo, 'Mod-Shift-Z': redo, 'Mod-y': redo, 'Mod-Y': redo };
  },
});

export function createExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
    }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Placeholder.configure({ placeholder: EDITOR_PLACEHOLDER }),
    // M11: AI 待辦事項 are inserted as a task list. Nested, so a list pasted into an item survives.
    TaskList,
    // zh-TW checkbox labels for screen readers (Tiptap's default label is English).
    TaskItem.configure({
      nested: true,
      a11y: {
        // Only the item's own first line: node.textContent would also read out every nested sub-task.
        checkboxLabel: (node, checked) =>
          `${checked ? '已完成' : '未完成'}待辦：${node.firstChild?.textContent || '空白項目'}`,
      },
    }),
    TranscriptGap,
    HistoryKeys,
  ];
}
