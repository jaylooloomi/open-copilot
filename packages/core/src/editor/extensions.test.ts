import { Editor, type JSONContent } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createExtensions, EDITOR_PLACEHOLDER } from './extensions';

let editor: Editor | undefined;

function makeEditor(html = '<p>Hello</p>') {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createExtensions(),
    content: html,
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

describe('createExtensions', () => {
  it('supports bold, italic and underline', () => {
    const e = makeEditor();
    e.chain().selectAll().toggleBold().toggleItalic().toggleUnderline().run();
    expect(e.isActive('bold')).toBe(true);
    expect(e.isActive('italic')).toBe(true);
    expect(e.isActive('underline')).toBe(true);
  });

  it('supports text color through TextStyle + Color', () => {
    const e = makeEditor();
    e.chain().selectAll().setColor('#dc2626').run();
    expect(e.getAttributes('textStyle').color).toBe('#dc2626');
    // jsdom normalises the inline style to rgb(), so only check that a coloured span exists.
    expect(e.getHTML()).toContain('<span style="color:');
  });

  it('supports multicolor highlight', () => {
    const e = makeEditor();
    e.chain().selectAll().setHighlight({ color: '#fef08a' }).run();
    expect(e.getAttributes('highlight').color).toBe('#fef08a');
    expect(e.getHTML()).toContain('<mark data-color="#fef08a"');
  });

  it('aligns paragraphs and headings', () => {
    const e = makeEditor('<p>a</p><h2>b</h2>');
    e.chain().selectAll().setTextAlign('right').run();
    const html = e.getHTML();
    expect(html).toContain('<p style="text-align: right;">a</p>');
    expect(html).toContain('<h2 style="text-align: right;">b</h2>');
  });

  it('supports headings 1-3 and both list types', () => {
    const e = makeEditor();
    // Put the cursor inside "Hello" (position 1 is the start of the first paragraph).
    e.chain().setTextSelection(2).setHeading({ level: 3 }).run();
    expect(e.isActive('heading', { level: 3 })).toBe(true);
    e.chain().setParagraph().toggleBulletList().run();
    expect(e.isActive('bulletList')).toBe(true);
    e.chain().toggleOrderedList().run();
    expect(e.isActive('orderedList')).toBe(true);
  });

  it('supports undo and redo', () => {
    const e = makeEditor('<p>Hello</p>');
    e.chain().selectAll().insertContent('Bye').run();
    expect(e.getText()).toBe('Bye');
    e.commands.undo();
    expect(e.getText()).toBe('Hello');
    e.commands.redo();
    expect(e.getText()).toBe('Bye');
  });

  it.each([
    ['Ctrl+Z', { key: 'z' }],
    ['Ctrl+Shift+Z', { key: 'Z', shiftKey: true }],
    ['Ctrl+Y', { key: 'y' }],
  ])('always handles %s, so the browser never runs its own contenteditable undo', (_name, keys) => {
    const e = makeEditor('<p>Hello</p>');
    // Nothing to undo or redo: ProseMirror's commands do nothing, but the key is still consumed.
    const event = new KeyboardEvent('keydown', { ctrlKey: true, cancelable: true, ...keys });
    e.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(e.getText()).toBe('Hello');
  });

  it('Ctrl+Shift+Z and Ctrl+Y still redo', () => {
    const e = makeEditor('<p>Hello</p>');
    e.chain().selectAll().insertContent('Bye').run();
    const press = (init: KeyboardEventInit) =>
      e.view.dom.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, cancelable: true, ...init }));
    press({ key: 'z' });
    expect(e.getText()).toBe('Hello');
    press({ key: 'Z', shiftKey: true });
    expect(e.getText()).toBe('Bye');
    press({ key: 'z' });
    press({ key: 'y' });
    expect(e.getText()).toBe('Bye');
  });

  it('shows the zh-TW placeholder on an empty document', () => {
    const e = makeEditor('<p></p>');
    expect(EDITOR_PLACEHOLDER).toBe('在這裡開始編寫筆記..');
    const empty = e.view.dom.querySelector('p');
    expect(empty).toHaveAttribute('data-placeholder', '在這裡開始編寫筆記..');
  });
});

describe('createExtensions task lists', () => {
  it('parses task lists and keeps each item checked state', () => {
    const e = makeEditor(
      '<ul data-type="taskList">' +
        '<li data-type="taskItem" data-checked="true"><p>寄出報價單</p></li>' +
        '<li data-type="taskItem" data-checked="false"><p>預約會議室</p></li>' +
        '</ul>',
    );
    const doc: JSONContent = e.getJSON();
    const list = doc.content?.[0];
    expect(list?.type).toBe('taskList');
    expect(list?.content?.map((item) => [item.type, item.attrs?.checked])).toEqual([
      ['taskItem', true],
      ['taskItem', false],
    ]);
    expect(e.view.dom.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  it('toggles a paragraph into a task list', () => {
    const e = makeEditor('<p>準備</p>');
    e.chain().setTextSelection(2).toggleTaskList().run();
    expect(e.isActive('taskList')).toBe(true);
    const doc: JSONContent = e.getJSON();
    const item = doc.content?.[0]?.content?.[0];
    expect(item?.attrs?.checked).toBe(false);
    expect(item?.content?.[0]?.content?.[0]?.text).toBe('準備');
    expect(e.getText().trim()).toBe('準備');
  });

  it('labels each checkbox in zh-TW for screen readers', () => {
    const e = makeEditor(
      '<ul data-type="taskList">' +
        '<li data-type="taskItem" data-checked="true"><p>寄出報價單</p></li>' +
        '<li data-type="taskItem" data-checked="false"><p></p></li>' +
        '</ul>',
    );
    const labels = [...e.view.dom.querySelectorAll('input[type="checkbox"]')].map((box) =>
      box.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['已完成待辦：寄出報價單', '未完成待辦：空白項目']);
  });

  it('lets a task item hold a nested task list', () => {
    const e = makeEditor(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>準備</p>' +
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>訂場地</p></li></ul>' +
        '</li></ul>',
    );
    const doc: JSONContent = e.getJSON();
    const outer = doc.content?.[0]?.content?.[0];
    expect(outer?.content?.map((child) => child.type)).toEqual(['paragraph', 'taskList']);
    // Each checkbox is labelled by its own line only, not by the nested sub-tasks under it.
    const labels = [...e.view.dom.querySelectorAll('input[type="checkbox"]')].map((box) =>
      box.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['未完成待辦：準備', '已完成待辦：訂場地']);
  });
});
