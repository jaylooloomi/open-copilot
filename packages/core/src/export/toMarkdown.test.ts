import { EMPTY_DOC, type JSONContent, type Note } from '@oc/shared';
import { describe, expect, it } from 'vitest';
import { toMarkdown } from './toMarkdown';

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
const gap: JSONContent = { type: 'transcriptGap', attrs: { gapId: 'g1', seq: 2 } };
const note = (title: string, ...blocks: JSONContent[]): Note => ({
  id: 'n1',
  title,
  content: { type: 'doc', content: blocks },
  createdAt: 1,
  updatedAt: 1,
});
const bold: Mark = { type: 'bold' };
const italic: Mark = { type: 'italic' };
const underline: Mark = { type: 'underline' };

describe('toMarkdown', () => {
  it('starts with the title as # and separates blocks with blank lines', () => {
    expect(toMarkdown(note('週會', p(text('第一段')), p(text('第二段'))))).toBe(
      '# 週會\n\n第一段\n\n第二段\n',
    );
  });

  it('omits the title when it is blank and returns nothing for an empty note', () => {
    expect(toMarkdown(note('  ', p(text('內文'))))).toBe('內文\n');
    expect(toMarkdown({ ...note(''), content: EMPTY_DOC })).toBe('');
    expect(toMarkdown({ ...note('只有標題'), content: EMPTY_DOC })).toBe('# 只有標題\n');
  });

  it('pushes body headings one level down', () => {
    expect(toMarkdown(note('T', h(1, '一'), h(2, '二'), h(3, '三')))).toBe(
      '# T\n\n## 一\n\n### 二\n\n#### 三\n',
    );
  });

  it('clamps heading levels to ##–###### and falls back to ## for a missing level', () => {
    const noLevel: JSONContent = { type: 'heading', content: [text('無')] };
    expect(toMarkdown(note('', h(6, 'x'), h(9, 'y'), h(0, 'z'), noLevel))).toBe(
      '###### x\n\n###### y\n\n## z\n\n## 無\n',
    );
  });

  it('turns a hard break in a heading into a space', () => {
    const heading: JSONContent = {
      type: 'heading',
      attrs: { level: 1 },
      content: [text('第一行'), { type: 'hardBreak' }, text('第二行')],
    };
    expect(toMarkdown(note('', heading))).toBe('## 第一行 第二行\n');
  });

  it('escapes a run of # at the end of the title or a heading', () => {
    expect(toMarkdown(note('Issue #', h(1, '#'), h(2, 'C#'), h(3, 'a ##')))).toBe(
      '# Issue \\#\n\n## \\#\n\n### C#\n\n#### a \\##\n',
    );
    expect(toMarkdown(note('#', p(text('x'))))).toBe('# \\#\n\nx\n');
  });

  it('writes bold, italic and underline, with underline outermost', () => {
    const doc = note(
      '',
      p(
        text('粗', bold),
        text('、'),
        text('斜', italic),
        text('、'),
        text('底', underline),
        text('、'),
        text('全', bold, italic, underline),
      ),
    );
    expect(toMarkdown(doc)).toBe('**粗**、*斜*、<u>底</u>、<u>***全***</u>\n');
  });

  it('keeps a mark open across neighbouring text with more marks', () => {
    expect(toMarkdown(note('', p(text('a', bold), text('b', bold, italic), text('c'))))).toBe(
      '**a*b***c\n',
    );
  });

  it('keeps spaces outside the delimiters', () => {
    expect(toMarkdown(note('', p(text('Hello'), text(' world ', bold), text('!'))))).toBe(
      'Hello **world** !\n',
    );
  });

  it('keeps edge punctuation outside ** and * so they still work between CJK letters', () => {
    expect(
      toMarkdown(note('', p(text('重點：', bold), text('內容'), text('「強調」', italic), text('後')))),
    ).toBe('**重點**：內容「*強調*」後\n');
    expect(toMarkdown(note('', p(text('請看'), text('「重要」', bold), text('這段'))))).toBe(
      '請看「**重要**」這段\n',
    );
    expect(toMarkdown(note('', p(text('前'), text('全', bold, underline), text('後'))))).toBe(
      '前<u>**全**</u>後\n',
    );
    expect(toMarkdown(note('', p(text('註：', underline), text('內容'))))).toBe('<u>註：</u>內容\n');
  });

  it('drops text colour, highlight and alignment', () => {
    const doc = note('', {
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [
        text('紅字', { type: 'textStyle', attrs: { color: '#dc2626' } }),
        text('螢光', { type: 'highlight', attrs: { color: '#fef08a' } }),
      ],
    });
    expect(toMarkdown(doc)).toBe('紅字螢光\n');
  });

  it('writes bullet and ordered lists with start numbers and nesting', () => {
    const doc = note(
      '',
      ul(item(p(text('a'))), item(p(text('b')), ol(1, item(p(text('c'))), item(p(text('d')))))),
      ol(9, item(p(text('i'))), item(p(text('j')), ul(item(p(text('k')))))),
    );
    expect(toMarkdown(doc)).toBe('- a\n- b\n  1. c\n  2. d\n\n9. i\n10. j\n    - k\n');
  });

  it('puts a blank line before a nested list that cannot interrupt a paragraph', () => {
    expect(toMarkdown(note('', ul(item(p(text('b')), ol(3, item(p(text('c'))))))))).toBe(
      '- b\n\n  3. c\n',
    );
    expect(toMarkdown(note('', ul(item(p(text('x')), ul(item(p()))))))).toBe('- x\n\n  -\n');
    expect(toMarkdown(note('', ul(item(p(text('y')), ol(1, item(p()), item(p(text('z'))))))))).toBe(
      '- y\n\n  1.\n  2. z\n',
    );
  });

  it('separates paragraphs inside one list item with a blank line', () => {
    expect(toMarkdown(note('', ul(item(p(text('第一段')), p(text('第二段'))))))).toBe(
      '- 第一段\n\n  第二段\n',
    );
  });

  it('writes hard breaks as backslash line breaks and drops a trailing one', () => {
    const doc = note('', p(text('a'), { type: 'hardBreak' }, text('b'), { type: 'hardBreak' }));
    expect(toMarkdown(doc)).toBe('a\\\nb\n');
  });

  it('escapes text that would otherwise become Markdown syntax', () => {
    const doc = note(
      '',
      p(text('1. 不是清單')),
      p(text('# 不是標題')),
      p(text('- 不是項目')),
      p(text('a*b_c [d] <u>e</u> `f`')),
    );
    expect(toMarkdown(doc)).toBe(
      '1\\. 不是清單\n\n\\# 不是標題\n\n\\- 不是項目\n\na\\*b\\_c \\[d\\] \\<u>e\\</u> \\`f\\`\n',
    );
  });

  it('escapes an & that would start an entity reference', () => {
    expect(toMarkdown(note('', p(text('&copy; 2026 Q&A &#169;'))))).toBe(
      '\\&copy; 2026 Q&A \\&#169;\n',
    );
  });

  it('writes an escaped [未轉寫片段] for transcript gaps and the text of unknown nodes', () => {
    const doc = note(
      '',
      p(text('前'), gap, text('後')),
      p(text('嗨 '), { type: 'mention', attrs: { id: 'u1' }, content: [text('@小明')] }),
      { type: 'blockquote', content: [p(text('引言一')), p(text('引言二'))] },
      { type: 'horizontalRule' },
      { type: 'callout', content: [p(text('提醒'))] },
    );
    expect(toMarkdown(doc)).toBe(
      '前\\[未轉寫片段\\]後\n\n嗨 @小明\n\n引言一\n\n引言二\n\n提醒\n',
    );
  });

  it('writes links as [text](href), keeping marks inside and dropping unsafe hrefs', () => {
    const link = (href: string): Mark => ({ type: 'link', attrs: { href, target: '_blank' } });
    const site = link('https://example.com/a b(1)');
    expect(
      toMarkdown(
        note(
          '',
          p(text('看'), text('官網', site), text('首頁', site, bold), text('，'), text('壞', link('javascript:alert(1)'))),
        ),
      ),
    ).toBe('看[官網**首頁**](https://example.com/a%20b\\(1\\))，壞\n');
    expect(toMarkdown(note('', p(text('[a]', link('mailto:a@b.co')))))).toBe('[\\[a\\]](mailto:a@b.co)\n');
  });

  it('keeps a transcript gap literal when (…) follows it', () => {
    expect(toMarkdown(note('', p(text('前'), gap, text('(見附件)'))))).toBe(
      '前\\[未轉寫片段\\](見附件)\n',
    );
  });
});
