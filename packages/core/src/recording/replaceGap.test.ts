import type { JSONContent } from '@oc/shared';
import { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createExtensions } from '../editor/extensions';
import { replaceGap } from './replaceGap';

const gap = (gapId: string, seq: number): JSONContent => ({ type: 'transcriptGap', attrs: { gapId, seq } });
const text = (value: string): JSONContent => ({ type: 'text', text: value });

let editor: Editor | undefined;

function makeEditor(...inline: JSONContent[]) {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createExtensions(),
    content: { type: 'doc', content: [{ type: 'paragraph', content: inline }] },
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

describe('replaceGap', () => {
  it('replaces the matching gap with the transcript', () => {
    const e = makeEditor(text('前'), gap('g1', 1), text('中'), gap('g2', 2), text('後'));
    expect(replaceGap(e, 'g2', '第二段')).toBe(true);
    expect(e.getText()).toBe('前[未轉寫片段]中第二段後');
    expect(e.getHTML()).toContain('data-transcript-gap="g1"');
    expect(e.getHTML()).not.toContain('data-transcript-gap="g2"');
  });

  it('removes the gap when the transcript is empty', () => {
    const e = makeEditor(text('前'), gap('g1', 1), text('後'));
    expect(replaceGap(e, 'g1', '')).toBe(true);
    expect(e.getHTML()).toBe('<p>前後</p>');
  });

  it('keeps the formatting the gap carried', () => {
    const e = makeEditor(text('前'), { ...gap('g1', 1), marks: [{ type: 'bold' }] }, text('後'));
    expect(replaceGap(e, 'g1', '重試')).toBe(true);
    expect(e.getHTML()).toBe('<p>前<strong>重試</strong>後</p>');
  });

  it('turns line breaks in the transcript into spaces', () => {
    const e = makeEditor(text('前'), gap('g1', 1), text('後'));
    expect(replaceGap(e, 'g1', '第一行\r\n第二行\n\n第三行')).toBe(true);
    expect(e.getText()).toBe('前第一行 第二行 第三行後');
  });

  it('stays out of the undo history, so Ctrl+Z cannot bring the retried marker back', () => {
    const e = makeEditor(text('前'), gap('g1', 1));
    e.commands.insertContentAt(e.state.doc.content.size - 1, '打字');
    expect(replaceGap(e, 'g1', '第一段')).toBe(true);
    e.commands.undo(); // undoes the user's typing only
    expect(e.getText()).toBe('前第一段');
    expect(e.getHTML()).not.toContain('data-transcript-gap');
  });

  it('keeps the marks the user turned on at the cursor', () => {
    const e = makeEditor(text('前'), gap('g1', 1), text('後'));
    e.commands.setTextSelection(2);
    e.commands.setMark('bold');
    expect(replaceGap(e, 'g1', '第一段')).toBe(true);
    expect(e.state.storedMarks?.map((m) => m.type.name)).toEqual(['bold']);
  });

  it('returns false when the gap is not in the document', () => {
    const e = makeEditor(text('前'), gap('g1', 1));
    expect(replaceGap(e, 'missing', '文字')).toBe(false);
    expect(e.getText()).toBe('前[未轉寫片段]');
  });
});
