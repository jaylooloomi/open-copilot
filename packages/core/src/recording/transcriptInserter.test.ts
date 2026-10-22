import { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createExtensions } from '../editor/extensions';
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
