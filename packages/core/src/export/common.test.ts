import type { JSONContent } from '@oc/shared';
import { describe, expect, it } from 'vitest';
import { formatListItem, listStart, nodeText, TRANSCRIPT_GAP_TEXT } from './common';

const text = (value: string): JSONContent => ({ type: 'text', text: value });
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });

describe('nodeText', () => {
  it('returns the text of a text node, ignoring its marks', () => {
    expect(nodeText({ type: 'text', text: '粗體', marks: [{ type: 'bold' }] })).toBe('粗體');
  });

  it('joins inline children directly and turns hard breaks into newlines', () => {
    expect(nodeText(p(text('第一行'), { type: 'hardBreak' }, text('第二行')))).toBe('第一行\n第二行');
  });

  it('joins block children with newlines', () => {
    expect(nodeText({ type: 'blockquote', content: [p(text('A')), p(text('B'))] })).toBe('A\nB');
  });

  it('writes [未轉寫片段] for a transcript gap', () => {
    expect(TRANSCRIPT_GAP_TEXT).toBe('[未轉寫片段]');
    expect(nodeText(p(text('前'), { type: 'transcriptGap', attrs: { gapId: 'g1', seq: 2 } }, text('後')))).toBe(
      '前[未轉寫片段]後',
    );
  });

  it('returns the text inside unknown nodes and nothing for empty ones', () => {
    expect(nodeText({ type: 'mention', content: [text('@小明')] })).toBe('@小明');
    expect(nodeText({ type: 'horizontalRule' })).toBe('');
  });
});

describe('listStart', () => {
  it('reads the start attribute and defaults to 1', () => {
    expect(listStart({ type: 'orderedList', attrs: { start: 3 } })).toBe(3);
    expect(listStart({ type: 'orderedList' })).toBe(1);
    expect(listStart({ type: 'orderedList', attrs: { start: 'x' } })).toBe(1);
  });
});

describe('formatListItem', () => {
  it('prefixes the first line and indents the rest by the marker width', () => {
    expect(formatListItem('- ', 'a\n- b')).toBe('- a\n  - b');
    expect(formatListItem('10. ', 'a\nb')).toBe('10. a\n    b');
  });

  it('leaves blank lines unindented and trims an empty item', () => {
    expect(formatListItem('- ', 'a\n\nb')).toBe('- a\n\n  b');
    expect(formatListItem('1. ', '')).toBe('1.');
  });
});
