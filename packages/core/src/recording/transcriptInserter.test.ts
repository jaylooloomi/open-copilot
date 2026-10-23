import { Editor, Mark, Node as TiptapNode } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createExtensions } from '../editor/extensions';
import { TranscriptGap } from '../editor/transcriptGap';
import { TRANSCRIPT_GAP_TEXT } from '../export/common';
import { TranscriptInserter } from './transcriptInserter';

let editor: Editor | undefined;

function makeEditor(html = '<p>AB</p>') {
  editor = new Editor({ element: document.createElement('div'), extensions: createExtensions(), content: html });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

describe('TranscriptInserter', () => {
  it('inserts consecutive transcripts one after another at the anchor', () => {
    const e = makeEditor();
    const inserter = new TranscriptInserter(e, 2); // between A and B
    inserter.insertText('一');
    inserter.insertText('二');
    expect(e.getText()).toBe('A一二B');
    expect(inserter.position).toBe(4);
  });

  it('follows the anchor when the user types before it', () => {
    const e = makeEditor();
    const inserter = new TranscriptInserter(e, 2);
    inserter.insertText('一');
    e.commands.insertContentAt(1, 'XY');
    inserter.insertText('二');
    expect(e.getText()).toBe('XYA一二B');
  });

  it('is not moved by typing after it', () => {
    const e = makeEditor();
    const inserter = new TranscriptInserter(e, 2);
    e.commands.insertContentAt(3, 'Z'); // after B
    inserter.insertText('一');
    expect(e.getText()).toBe('A一BZ');
  });

  it('does not move the user’s cursor', () => {
    const e = makeEditor();
    e.commands.setTextSelection(3); // after B
    const inserter = new TranscriptInserter(e, 1); // before A
    inserter.insertText('一二');
    expect(e.getText()).toBe('一二AB');
    expect(e.state.selection.from).toBe(5); // still after B
  });

  it('turns line breaks in a transcript into spaces, like a retried one', () => {
    const e = makeEditor('<p></p>');
    new TranscriptInserter(e, 1).insertText('第一行\r\n第二行\n\n第三行');
    expect(e.getHTML()).toBe('<p>第一行 第二行 第三行</p>');
  });

  it('inserts plain text even inside bold text', () => {
    const e = makeEditor('<p><strong>AB</strong></p>');
    new TranscriptInserter(e, 2).insertText('一');
    expect(e.getHTML()).toBe('<p><strong>A</strong>一<strong>B</strong></p>');
  });

  it('inserts a gap marker in order with the text', () => {
    const e = makeEditor('<p></p>');
    const inserter = new TranscriptInserter(e, 1);
    inserter.insertText('一');
    inserter.insertGap('g2', 2);
    inserter.insertText('三');
    expect(e.getHTML()).toBe(
      '<p>一<span class="oc-gap" data-transcript-gap="g2">⚠ 第 2 段未轉寫・重試</span>三</p>',
    );
  });

  it('moves an anchor outside any paragraph to the nearest text position', () => {
    const e = makeEditor('<p>A</p><p>B</p>');
    const inserter = new TranscriptInserter(e, e.state.doc.content.size); // after the last paragraph
    inserter.insertText('一');
    expect(e.getHTML()).toBe('<p>A</p><p>B一</p>');
  });

  it('keeps consecutive inserts in one paragraph after the anchor paragraph is deleted', () => {
    const e = makeEditor('<p>A</p><p>B</p><p>C</p>');
    const inserter = new TranscriptInserter(e, 4); // inside B
    e.commands.deleteRange({ from: 3, to: 6 }); // removes the whole B paragraph
    inserter.insertText('一');
    inserter.insertGap('g1', 1);
    inserter.insertText('三');
    expect(e.getHTML()).toBe(
      '<p>A一<span class="oc-gap" data-transcript-gap="g1">⚠ 第 1 段未轉寫・重試</span>三</p><p>C</p>',
    );
  });

  it('keeps inserting into one paragraph after select-all and delete', () => {
    const e = makeEditor('<p>AB</p><p>CD</p>');
    const inserter = new TranscriptInserter(e, 2);
    e.commands.selectAll();
    e.commands.deleteSelection();
    inserter.insertText('一');
    inserter.insertText('二');
    expect(e.getHTML()).toBe('<p>一二</p>');
  });

  it('never moves the user’s code out of a code block when a gap arrives', () => {
    const e = makeEditor('<pre><code>ab</code></pre>');
    const inserter = new TranscriptInserter(e, 2); // between a and b
    inserter.insertText('一');
    inserter.insertGap('g1', 1);
    inserter.insertText('三');
    expect(e.getHTML()).toBe(
      '<pre><code>a一b</code></pre><p><span class="oc-gap" data-transcript-gap="g1">⚠ 第 1 段未轉寫・重試</span>三</p><p></p>', // the trailing empty paragraph comes from the editor's trailing-node rule
    );
  });

  it('handles a horizontal rule selected as the first block when recording starts', () => {
    const e = makeEditor('<hr><p>B</p>');
    e.commands.setNodeSelection(0);
    const inserter = new TranscriptInserter(e, e.state.selection.to);
    inserter.insertText('一');
    inserter.insertGap('g1', 1);
    inserter.insertText('三');
    expect(e.getHTML()).toBe(
      '<hr><p>一<span class="oc-gap" data-transcript-gap="g1">⚠ 第 1 段未轉寫・重試</span>三B</p>',
    );
  });

  it('keeps inserting after the anchor paragraph that followed a horizontal rule is deleted', () => {
    const e = makeEditor('<p>A</p><hr><p>B</p><p>C</p>');
    const inserter = new TranscriptInserter(e, 7); // inside B
    e.commands.deleteRange({ from: 4, to: 7 }); // remove paragraph B
    inserter.insertText('一');
    inserter.insertGap('g1', 1);
    inserter.insertText('二');
    expect(e.getHTML()).toBe(
      '<p>A一<span class="oc-gap" data-transcript-gap="g1">⚠ 第 1 段未轉寫・重試</span>二</p><hr><p>C</p>',
    );
  });

  it('keeps the marks the user turned on at the cursor when a transcript arrives', () => {
    const e = makeEditor('<p>AB</p>');
    e.commands.setTextSelection(3);
    e.commands.toggleBold();
    const inserter = new TranscriptInserter(e, 2);
    inserter.insertText('一');
    inserter.insertGap('g1', 1);
    expect(e.state.storedMarks?.map((m) => m.type.name)).toEqual(['bold']);
    e.commands.insertContent('X');
    expect(e.getHTML()).toContain('<strong>X</strong>');
  });

  it('keeps transcripts out of the undo history', () => {
    const e = makeEditor('<p>AB</p>');
    const inserter = new TranscriptInserter(e, 2);
    e.commands.insertContentAt(3, 'Z');
    inserter.insertText('一');
    e.commands.undo();
    expect(e.getText()).toBe('A一B');
  });

  it('writes the last-resort placeholder as plain text inside bold text', () => {
    // A schema with no paragraph and a block that only takes text: the gap node fits nowhere.
    const PlainBlock = TiptapNode.create({
      name: 'plainBlock',
      group: 'block',
      content: 'text*',
      marks: '_',
      parseHTML: () => [{ tag: 'div' }],
      renderHTML: () => ['div', 0],
    });
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [
        TiptapNode.create({
          name: 'doc',
          topNode: true,
          content: 'plainBlock+',
        }),
        TiptapNode.create({ name: 'text', group: 'inline' }),
        Mark.create({
          name: 'bold',
          parseHTML: () => [{ tag: 'strong' }],
          renderHTML: () => ['strong', 0],
        }),
        PlainBlock,
        TranscriptGap,
      ],
      content: '<div><strong>AB</strong></div>',
    });
    const inserter = new TranscriptInserter(editor, 2);
    inserter.insertGap('g1', 1);
    expect(editor.getHTML()).toBe(
      `<div><strong>A</strong>${TRANSCRIPT_GAP_TEXT}<strong>B</strong></div>`,
    );
  });

  it('ignores empty text and stops after destroy()', () => {
    const e = makeEditor();
    const inserter = new TranscriptInserter(e, 2);
    inserter.insertText('');
    inserter.destroy();
    inserter.insertText('一');
    inserter.insertGap('g1', 1);
    expect(e.getText()).toBe('AB');
  });
});
