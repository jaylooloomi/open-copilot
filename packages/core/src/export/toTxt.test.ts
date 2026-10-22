import { EMPTY_DOC, type JSONContent, type Note } from '@oc/shared';
import { describe, expect, it } from 'vitest';
import { toTxt } from './toTxt';

type Mark = NonNullable<JSONContent['marks']>[number];

const text = (value: string, ...marks: Mark[]): JSONContent =>
  marks.length > 0 ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const h = (level: number, value: string): JSONContent => ({
  type: 'heading',
  attrs: { level, textAlign: null },
  content: [text(value)],
});
const item = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content });
const ul = (...items: JSONContent[]): JSONContent => ({ type: 'bulletList', content: items });
const ol = (start: number, ...items: JSONContent[]): JSONContent => ({
  type: 'orderedList',
  attrs: { start, type: null },
  content: items,
});
const note = (title: string, ...blocks: JSONContent[]): Note => ({
  id: 'n1',
  title,
  content: { type: 'doc', content: blocks },
  createdAt: 1,
  updatedAt: 1,
});

describe('toTxt', () => {
  it('writes the title, a blank line, then one line per paragraph', () => {
    expect(toTxt(note('週會', p(text('第一段')), p(text('第二段'))))).toBe('週會\n\n第一段\n第二段');
  });

  it('drops every mark, heading level and alignment', () => {
    const doc = note(
      '',
      h(1, '大標'),
      {
        type: 'paragraph',
        attrs: { textAlign: 'center' },
        content: [
          text('粗', { type: 'bold' }),
          text('斜', { type: 'italic' }),
          text('底', { type: 'underline' }),
          text('紅', { type: 'textStyle', attrs: { color: '#dc2626' } }),
          text('黃', { type: 'highlight', attrs: { color: '#fef08a' } }),
        ],
      },
    );
    expect(toTxt(doc)).toBe('大標\n粗斜底紅黃');
  });

  it('keeps list markers, ordered start numbers and nesting', () => {
    const doc = note(
      '',
      ul(item(p(text('a'))), item(p(text('b')), ol(1, item(p(text('c'))), item(p(text('d')))))),
      ol(3, item(p(text('e'))), item(p(text('f')))),
    );
    expect(toTxt(doc)).toBe('- a\n- b\n  1. c\n  2. d\n3. e\n4. f');
  });

  it('turns hard breaks into newlines and keeps blank lines between paragraphs', () => {
    const doc = note('', p(), p(text('a'), { type: 'hardBreak' }, text('b')), p(), p(text('c')), p());
    expect(toTxt(doc)).toBe('a\nb\n\nc');
  });

  it('omits the title line when the title is blank', () => {
    expect(toTxt(note('   ', p(text('只有內文'))))).toBe('只有內文');
  });

  it('returns only the title when the body is empty, and nothing for an empty note', () => {
    expect(toTxt({ ...note('標題'), content: EMPTY_DOC })).toBe('標題');
    expect(toTxt({ ...note(''), content: EMPTY_DOC })).toBe('');
  });

  it('writes a link as "text (href)" unless the text already is the address', () => {
    const link = (href: string): Mark => ({ type: 'link', attrs: { href, target: '_blank' } });
    const doc = note(
      '',
      p(text('看'), text('官網', link('https://example.com')), text('與'), text('文件', link('https://example.com'), { type: 'bold' })),
      p(text('https://example.com', link('https://example.com')), text(' a@b.co', link('mailto:a@b.co'))),
      p(text('壞', link('javascript:alert(1)'))),
    );
    expect(toTxt(doc)).toBe(
      '看官網 (https://example.com)與文件 (https://example.com)\nhttps://example.com a@b.co\n壞',
    );
  });

  it('writes [未轉寫片段] for transcript gaps and the text of unknown nodes', () => {
    const doc = note(
      '',
      p(text('前'), { type: 'transcriptGap', attrs: { gapId: 'g1', seq: 2 } }, text('後')),
      p(text('嗨 '), { type: 'mention', attrs: { id: 'u1' }, content: [text('@小明')] }),
      { type: 'blockquote', content: [p(text('引言一')), p(text('引言二'))] },
      { type: 'callout', content: [p(text('提醒'))] },
    );
    expect(toTxt(doc)).toBe('前[未轉寫片段]後\n嗨 @小明\n引言一\n引言二\n提醒');
  });
});
