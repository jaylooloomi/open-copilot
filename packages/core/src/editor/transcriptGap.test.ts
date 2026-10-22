import type { JSONContent, Note } from '@oc/shared';
import { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { toHtml } from '../export/toHtml';
import { toMarkdown } from '../export/toMarkdown';
import { toTxt } from '../export/toTxt';
import { createExtensions } from './extensions';
import { gapLabel, TranscriptGap } from './transcriptGap';

const GAP_DOC: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '前' },
        { type: 'transcriptGap', attrs: { gapId: 'g1', seq: 2 } },
        { type: 'text', text: '後' },
      ],
    },
  ],
};

let editor: Editor | undefined;

function makeEditor(content: JSONContent | string = GAP_DOC) {
  editor = new Editor({ element: document.createElement('div'), extensions: createExtensions(), content });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

describe('TranscriptGap', () => {
  it('is an inline atom named transcriptGap, registered by createExtensions', () => {
    expect(TranscriptGap.name).toBe('transcriptGap');
    const type = makeEditor().schema.nodes.transcriptGap;
    expect(type.isInline).toBe(true);
    expect(type.isAtom).toBe(true);
  });

  it('renders the contract markup', () => {
    expect(gapLabel(2)).toBe('⚠ 第 2 段未轉寫・重試');
    expect(makeEditor().getHTML()).toBe(
      '<p>前<span class="oc-gap" data-transcript-gap="g1">⚠ 第 2 段未轉寫・重試</span>後</p>',
    );
  });

  it('shows the label inside the editor', () => {
    const gap = makeEditor().view.dom.querySelector('[data-transcript-gap="g1"]');
    expect(gap).toHaveTextContent('⚠ 第 2 段未轉寫・重試');
    expect(gap).toHaveClass('oc-gap');
  });

  it('keeps gapId and seq in JSON and reads them back from its HTML', () => {
    const first = makeEditor();
    const json = first.getJSON();
    expect(json).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: null },
          content: [
            { type: 'text', text: '前' },
            { type: 'transcriptGap', attrs: { gapId: 'g1', seq: 2 } },
            { type: 'text', text: '後' },
          ],
        },
      ],
    });
    const html = first.getHTML();
    first.destroy();
    expect(makeEditor(html).getJSON()).toEqual(json);
  });

  it('is plain text [未轉寫片段] for getText and every exporter', () => {
    const e = makeEditor();
    const note: Note = { id: 'n1', title: '', content: e.getJSON(), createdAt: 1, updatedAt: 1 };
    expect(e.getText()).toBe('前[未轉寫片段]後');
    expect(toTxt(note)).toBe('前[未轉寫片段]後');
    expect(toMarkdown(note)).toBe('前\\[未轉寫片段\\]後\n');
    expect(toHtml(note)).toBe('<p>前[未轉寫片段]後</p>');
  });
});
