import { EMPTY_DOC, type JSONContent, type Note } from '@oc/shared';
import { describe, expect, it } from 'vitest';
import { escapeHtml, toHtml } from './toHtml';

type Mark = NonNullable<JSONContent['marks']>[number];

const text = (value: string, ...marks: Mark[]): JSONContent =>
  marks.length > 0 ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const item = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content });
const note = (title: string, ...blocks: JSONContent[]): Note => ({
  id: 'n1',
  title,
  content: { type: 'doc', content: blocks },
  createdAt: 1,
  updatedAt: 1,
});

describe('toHtml', () => {
  it('puts the escaped title in an <h1> before the body', () => {
    expect(toHtml(note('A & B <C>', p(text('內文'))))).toBe('<h1>A &amp; B &lt;C&gt;</h1><p>內文</p>');
  });

  it('keeps a malformed or out-of-range heading level below the title <h1> range', () => {
    const h = (level: unknown): JSONContent => ({ type: 'heading', attrs: { level }, content: [text('t')] });
    expect(toHtml(note('', h('x')))).toBe('<h1>t</h1>');
    expect(toHtml(note('', h(0)))).toBe('<h1>t</h1>');
    expect(toHtml(note('', h(9)))).toBe('<h3>t</h3>');
    expect(toHtml(note('', h('2')))).toBe('<h2>t</h2>');
    expect(toHtml(note('', h(2.6)))).toBe('<h2>t</h2>');
  });

  it('returns only the body when the title is blank', () => {
    expect(toHtml(note('  ', p(text('內文'))))).toBe('<p>內文</p>');
    expect(toHtml({ ...note(''), content: EMPTY_DOC })).toBe('<p></p>');
  });

  it('keeps marks, colours, highlight, headings and alignment', () => {
    const html = toHtml(
      note(
        '',
        { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [text('小標')] },
        p(
          text('粗', { type: 'bold' }),
          text('斜', { type: 'italic' }),
          text('底', { type: 'underline' }),
          text('紅', { type: 'textStyle', attrs: { color: '#dc2626' } }),
          text('黃', { type: 'highlight', attrs: { color: '#fef08a' } }),
        ),
      ),
    );
    expect(html).toContain('<h2 style="text-align: center;">小標</h2>');
    expect(html).toContain('<strong>粗</strong><em>斜</em><u>底</u>');
    // jsdom normalises inline colours to rgb().
    expect(html).toContain('<span style="color: rgb(220, 38, 38);">紅</span>');
    expect(html).toContain('<mark data-color="#fef08a"');
  });

  it('keeps bullet and ordered lists with their start number', () => {
    const html = toHtml(
      note(
        '',
        { type: 'bulletList', content: [item(p(text('a')))] },
        { type: 'orderedList', attrs: { start: 3 }, content: [item(p(text('b')))] },
      ),
    );
    expect(html).toBe('<ul><li><p>a</p></li></ul><ol start="3"><li><p>b</p></li></ol>');
  });

  it('writes [未轉寫片段] for transcript gaps', () => {
    const html = toHtml(
      note('', p(text('前'), { type: 'transcriptGap', attrs: { gapId: 'g1', seq: 2 } }, text('後'))),
    );
    expect(html).toBe('<p>前[未轉寫片段]後</p>');
  });

  it('turns unknown nodes into their text and drops unknown marks instead of throwing', () => {
    const html = toHtml(
      note(
        '',
        p(
          text('嗨 '),
          { type: 'mention', attrs: { id: 'u1' }, content: [text('@小明')] },
          text('!', { type: 'comment', attrs: { id: 'c1' } }),
        ),
        { type: 'callout', content: [p(text('提醒一')), p(text('提醒二'))] },
      ),
    );
    expect(html).toBe('<p>嗨 @小明!</p><p>提醒一<br>提醒二</p>');
  });
  it('drops empty text nodes, which the schema would otherwise reject', () => {
    expect(toHtml(note('', p(text(''), text('x'))))).toBe('<p>x</p>');
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-sensitive characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('toHtml task lists', () => {
  it('keeps task lists with their checkboxes and checked state', () => {
    const html = toHtml(
      note('', {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [p(text('寄出報價單'))] },
          { type: 'taskItem', attrs: { checked: false }, content: [p(text('預約會議室'))] },
        ],
      }),
    );
    expect(html).toContain('<ul data-type="taskList">');
    expect(html).toContain('data-checked="true"');
    expect(html).toMatch(/<input type="checkbox" checked="checked"\s*\/?>/);
    expect(html).toContain('<p>寄出報價單</p>');
  });
});
