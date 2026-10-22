import type { JSONContent } from '@oc/shared';
import { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createExtensions } from '../editor/extensions';
import { insertSummaryAtStart, insertTodosAtEnd, summaryLines, TODO_HEADING } from './insertAi';

let editor: Editor | undefined;

function makeEditor(html: string) {
  editor = new Editor({ element: document.createElement('div'), extensions: createExtensions(), content: html });
  return editor;
}

afterEach(() => {
  if (editor && !editor.isDestroyed) editor.destroy();
  editor = undefined;
});

/** A node's text; the texts of block children are joined with `|`. */
function textOf(node: JSONContent): string {
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map(textOf).join('|');
}

/** [type, text] of every top-level block. */
const texts = (e: Editor) => (e.getJSON().content ?? []).map((node) => [node.type, textOf(node)]);

describe('summaryLines', () => {
  it('keeps each non-blank line, trimmed', () => {
    expect(summaryLines(' 第一點 \r\n\n第二點\n  ')).toEqual(['第一點', '第二點']);
  });
});

describe('insertSummaryAtStart', () => {
  it('puts each summary line as its own paragraph before the note', () => {
    const e = makeEditor('<p>原文</p>');
    expect(insertSummaryAtStart(e, '摘要一\n摘要二')).toBe(true);
    expect(texts(e)).toEqual([
      ['paragraph', '摘要一'],
      ['paragraph', '摘要二'],
      ['paragraph', '原文'],
    ]);
  });

  it('can be undone in one step', () => {
    const e = makeEditor('<p>原文</p>');
    insertSummaryAtStart(e, '摘要一\n摘要二');
    e.commands.undo();
    expect(texts(e)).toEqual([['paragraph', '原文']]);
  });

  it('inserts nothing for a blank summary', () => {
    const e = makeEditor('<p>原文</p>');
    expect(insertSummaryAtStart(e, ' \n ')).toBe(false);
    expect(texts(e)).toEqual([['paragraph', '原文']]);
  });
});

describe('insertTodosAtEnd', () => {
  it('adds a 待辦事項 heading and a task list at the end, keeping each checked state', () => {
    const e = makeEditor('<p>原文</p>');
    const ok = insertTodosAtEnd(e, [
      { text: '寄出報價單', checked: false },
      { text: ' 預約會議室 ', checked: true },
      { text: '  ', checked: false },
    ]);
    expect(ok).toBe(true);
    const content: JSONContent[] = e.getJSON().content ?? [];
    expect(TODO_HEADING).toBe('待辦事項');
    // StarterKit's trailing node keeps an empty paragraph after the list.
    expect(content.map((node) => node.type)).toEqual(['paragraph', 'heading', 'taskList', 'paragraph']);
    expect(content[1]).toMatchObject({ attrs: { level: 2 }, content: [{ type: 'text', text: '待辦事項' }] });
    expect(content[2]!.content?.map((item) => [item.type, item.attrs?.checked, textOf(item)])).toEqual([
      ['taskItem', false, '寄出報價單'],
      ['taskItem', true, '預約會議室'],
    ]);
  });

  it('replaces the empty paragraph a note ends with', () => {
    const e = makeEditor('<p>原文</p><p></p>');
    insertTodosAtEnd(e, [{ text: '寄出報價單', checked: false }]);
    expect((e.getJSON().content ?? []).map((node) => node.type)).toEqual([
      'paragraph',
      'heading',
      'taskList',
      'paragraph',
    ]);
  });

  it('inserts nothing when no item has text', () => {
    const e = makeEditor('<p>原文</p>');
    expect(insertTodosAtEnd(e, [{ text: ' ', checked: true }])).toBe(false);
    expect(texts(e)).toEqual([['paragraph', '原文']]);
  });

  it('does nothing on a destroyed editor', () => {
    const e = makeEditor('<p>原文</p>');
    e.destroy();
    expect(insertTodosAtEnd(e, [{ text: '寄出報價單', checked: false }])).toBe(false);
    expect(insertSummaryAtStart(e, '摘要')).toBe(false);
  });
});
