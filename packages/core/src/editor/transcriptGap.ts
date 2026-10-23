import { mergeAttributes, Node as TiptapNode } from '@tiptap/react';
import { TRANSCRIPT_GAP_TEXT, TRANSCRIPT_GAP_TYPE } from '../export/common';

/** Text shown for an untranscribed segment; clicking it retries (see NotesApp). */
export function gapLabel(seq: number): string {
  return `⚠ 第 ${seq} 段未轉寫・重試`;
}

/**
 * Inline, atomic marker for a recording segment that could not be transcribed.
 * Renders `<span class="oc-gap" data-transcript-gap="{gapId}">⚠ 第 {seq} 段未轉寫・重試</span>`.
 */
export const TranscriptGap = TiptapNode.create({
  name: TRANSCRIPT_GAP_TYPE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      gapId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-transcript-gap') ?? '',
        renderHTML: (attributes) => ({ 'data-transcript-gap': attributes.gapId }),
      },
      seq: {
        default: 0,
        // Not written as an attribute: the number is part of the label.
        parseHTML: (element) => Number(/第\s*(\d+)\s*段/.exec(element.textContent ?? '')?.[1] ?? 0),
        rendered: false,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-transcript-gap]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes({ class: 'oc-gap' }, HTMLAttributes), gapLabel(node.attrs.seq)];
  },

  renderText() {
    return TRANSCRIPT_GAP_TEXT;
  },
});
