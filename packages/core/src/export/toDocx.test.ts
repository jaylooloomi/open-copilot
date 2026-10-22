import type { JSONContent, Note } from '@oc/shared';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { toDocx } from './toDocx';

type Mark = NonNullable<JSONContent['marks']>[number];

const text = (value: string, ...marks: Mark[]): JSONContent =>
  marks.length > 0 ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
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

// ---------- helpers: unzip the .docx and summarise its XML ----------

interface RunInfo {
  text: string;
  breaks: number;
  bold: boolean;
  italic: boolean;
  underline: string | null;
  strike: boolean;
  color: string | null;
  fill: string | null;
}

interface ParagraphInfo {
  style: string | null;
  align: string | null;
  indentLeft: string | null;
  list: { format: string | null; start: string | null; level: number; numId: string } | null;
  text: string;
  runs: RunInfo[];
}

const W = (el: Element | Document, tag: string) => Array.from(el.getElementsByTagName(`w:${tag}`));
const child = (el: Element | undefined, tag: string) =>
  el ? Array.from(el.children).find((c) => c.tagName === `w:${tag}`) : undefined;
const val = (el: Element | undefined) => el?.getAttribute('w:val') ?? null;

async function readDocx(blob: Blob) {
  const zip = await JSZip.loadAsync(blob);
  const xml = async (path: string) =>
    new DOMParser().parseFromString(await zip.file(path)!.async('string'), 'application/xml');
  const documentXml = await xml('word/document.xml');
  const numberingXml = await xml('word/numbering.xml');
  const coreXml = await zip.file('docProps/core.xml')!.async('string');

  // numId → abstractNum element
  const abstractById = new Map(W(numberingXml, 'abstractNum').map((a) => [a.getAttribute('w:abstractNumId'), a]));
  const abstractForNum = new Map(
    W(numberingXml, 'num').map((n) => [n.getAttribute('w:numId'), abstractById.get(val(child(n, 'abstractNumId')))]),
  );

  const paragraphs: ParagraphInfo[] = W(documentXml, 'p').map((para) => {
    const pPr = child(para, 'pPr');
    const numPr = child(pPr, 'numPr');
    let list: ParagraphInfo['list'] = null;
    if (numPr) {
      const numId = val(child(numPr, 'numId'))!;
      const level = Number(val(child(numPr, 'ilvl')));
      const lvl = W(abstractForNum.get(numId)!, 'lvl').find((l) => l.getAttribute('w:ilvl') === String(level));
      list = { format: val(child(lvl, 'numFmt')), start: val(child(lvl, 'start')), level, numId };
    }
    const runs: RunInfo[] = W(para, 'r').map((r) => {
      const rPr = child(r, 'rPr');
      return {
        text: W(r, 't').map((t) => t.textContent).join(''),
        breaks: W(r, 'br').length,
        bold: !!child(rPr, 'b'),
        italic: !!child(rPr, 'i'),
        underline: val(child(rPr, 'u')),
        strike: !!child(rPr, 'strike'),
        color: val(child(rPr, 'color')),
        fill: child(rPr, 'shd')?.getAttribute('w:fill') ?? null,
      };
    });
    return {
      style: val(child(pPr, 'pStyle')),
      align: val(child(pPr, 'jc')),
      indentLeft: child(pPr, 'ind')?.getAttribute('w:left') ?? null,
      list,
      text: runs.map((r) => r.text).join(''),
      runs,
    };
  });
  return { paragraphs, coreXml };
}

// ---------- tests ----------

describe('toDocx', () => {
  it('returns a Word blob whose first paragraph is the title in the Title style', async () => {
    const blob = await toDocx(note('週會紀錄', p(text('內文'))));
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    const { paragraphs, coreXml } = await readDocx(blob);
    expect(paragraphs.map((x) => [x.style, x.text])).toEqual([
      ['Title', '週會紀錄'],
      [null, '內文'],
    ]);
    expect(coreXml).toContain('<dc:title>週會紀錄</dc:title>');
  });

  it('leaves out the title paragraph when the title is blank', async () => {
    const { paragraphs, coreXml } = await readDocx(await toDocx(note('  ', p(text('內文')))));
    expect(paragraphs.map((x) => x.text)).toEqual(['內文']);
    expect(coreXml).toContain('<dc:title>未命名筆記</dc:title>');
  });

  it('still writes one empty paragraph for a completely empty note', async () => {
    const { paragraphs } = await readDocx(await toDocx(note('')));
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].text).toBe('');
  });

  it('keeps bold, italic, underline, text colour and highlight on the runs', async () => {
    const { paragraphs } = await readDocx(
      await toDocx(
        note(
          '',
          p(
            text('粗', { type: 'bold' }),
            text('斜', { type: 'italic' }),
            text('底', { type: 'underline' }),
            text('紅', { type: 'textStyle', attrs: { color: '#dc2626' } }),
            text('藍', { type: 'textStyle', attrs: { color: 'rgb(37, 99, 235)' } }),
            text('黃', { type: 'highlight', attrs: { color: '#fef08a' } }),
            text('預設', { type: 'highlight', attrs: { color: null } }),
            text('全', { type: 'bold' }, { type: 'italic' }, { type: 'underline' }),
          ),
        ),
      ),
    );
    const runs = Object.fromEntries(paragraphs[0].runs.map((r) => [r.text, r]));
    expect(runs['粗']).toMatchObject({ bold: true, italic: false, underline: null });
    expect(runs['斜']).toMatchObject({ bold: false, italic: true });
    expect(runs['底']).toMatchObject({ underline: 'single' });
    expect(runs['紅'].color).toBe('DC2626');
    expect(runs['藍'].color).toBe('2563EB');
    expect(runs['黃'].fill).toBe('FEF08A');
    expect(runs['預設'].fill).toBe('FEF08A');
    expect(runs['全']).toMatchObject({ bold: true, italic: true, underline: 'single', color: null, fill: null });
  });

  it('ignores colours it cannot convert to hex', async () => {
    const { paragraphs } = await readDocx(
      await toDocx(note('', p(text('紅', { type: 'textStyle', attrs: { color: 'red' } })))),
    );
    expect(paragraphs[0].runs[0].color).toBeNull();
  });

  it('maps headings to Heading 1-3 and keeps alignment', async () => {
    const heading = (level: number, value: string, textAlign: string | null = null): JSONContent => ({
      type: 'heading',
      attrs: { level, textAlign },
      content: [text(value)],
    });
    const aligned = (textAlign: string | null, value: string): JSONContent => ({
      type: 'paragraph',
      attrs: { textAlign },
      content: [text(value)],
    });
    const { paragraphs } = await readDocx(
      await toDocx(
        note(
          '',
          heading(1, '一'),
          heading(2, '二', 'center'),
          heading(3, '三'),
          aligned('left', '左'),
          aligned('center', '中'),
          aligned('right', '右'),
          aligned('justify', '齊'),
          aligned(null, '無'),
        ),
      ),
    );
    expect(paragraphs.map((x) => [x.text, x.style, x.align])).toEqual([
      ['一', 'Heading1', null],
      ['二', 'Heading2', 'center'],
      ['三', 'Heading3', null],
      ['左', null, 'left'],
      ['中', null, 'center'],
      ['右', null, 'right'],
      ['齊', null, 'both'],
      ['無', null, null],
    ]);
  });

  it('writes bullet and numbered lists with levels, start numbers and restarts', async () => {
    const { paragraphs } = await readDocx(
      await toDocx(
        note(
          '',
          ul(item(p(text('a'))), item(p(text('b')), ul(item(p(text('b1')))))),
          ol(1, item(p(text('一'))), item(p(text('二')))),
          p(text('中間')),
          ol(3, item(p(text('三')))),
        ),
      ),
    );
    const lists = paragraphs.map((x) => [x.text, x.list && { ...x.list, numId: undefined }]);
    expect(lists).toEqual([
      ['a', { format: 'bullet', start: '1', level: 0, numId: undefined }],
      ['b', { format: 'bullet', start: '1', level: 0, numId: undefined }],
      ['b1', { format: 'bullet', start: '1', level: 1, numId: undefined }],
      ['一', { format: 'decimal', start: '1', level: 0, numId: undefined }],
      ['二', { format: 'decimal', start: '1', level: 0, numId: undefined }],
      ['中間', null],
      ['三', { format: 'decimal', start: '3', level: 0, numId: undefined }],
    ]);
    const numId = (t: string) => paragraphs.find((x) => x.text === t)?.list?.numId;
    expect(numId('一')).toBe(numId('二'));
    expect(numId('三')).not.toBe(numId('一'));
  });

  it('indents a second paragraph of a list item without a new bullet', async () => {
    const { paragraphs } = await readDocx(await toDocx(note('', ul(item(p(text('第一段')), p(text('第二段')))))));
    expect(paragraphs.map((x) => [x.text, x.list?.format ?? null, x.indentLeft])).toEqual([
      ['第一段', 'bullet', null],
      ['第二段', null, '720'],
    ]);
  });

  it('keeps hard breaks and empty paragraphs', async () => {
    const { paragraphs } = await readDocx(
      await toDocx(note('', p(text('a'), { type: 'hardBreak' }, text('b')), p(), p(text('c')))),
    );
    expect(paragraphs.map((x) => x.text)).toEqual(['ab', '', 'c']);
    expect(paragraphs[0].runs.map((r) => [r.text, r.breaks])).toEqual([
      ['a', 0],
      ['', 1],
      ['b', 0],
    ]);
  });

  it('writes [未轉寫片段] for transcript gaps and the text of unknown nodes', async () => {
    const { paragraphs } = await readDocx(
      await toDocx(
        note(
          '',
          p(text('前'), { type: 'transcriptGap', attrs: { gapId: 'g1', seq: 2 } }, text('後')),
          p(text('嗨 '), { type: 'mention', attrs: { id: 'u1' }, content: [text('@小明')] }),
          { type: 'callout', content: [p(text('提醒一')), p(text('提醒二'))] },
          { type: 'horizontalRule' },
        ),
      ),
    );
    expect(paragraphs.map((x) => x.text)).toEqual(['前[未轉寫片段]後', '嗨 @小明', '提醒一提醒二']);
    expect(paragraphs[2].runs.map((r) => r.breaks)).toEqual([0, 1]);
  });

  it('keeps strike-through on the runs', async () => {
    const { paragraphs } = await readDocx(await toDocx(note('', p(text('刪', { type: 'strike' }), text('留')))));
    expect(paragraphs[0].runs.map((r) => [r.text, r.strike])).toEqual([
      ['刪', true],
      ['留', false],
    ]);
  });

  it('renders blockquote children indented, keeping their formatting and list bullets', async () => {
    const { paragraphs } = await readDocx(
      await toDocx(
        note(
          '',
          {
            type: 'blockquote',
            content: [p(text('引', { type: 'bold' })), ul(item(p(text('項目'))))],
          },
          p(text('外')),
        ),
      ),
    );
    expect(paragraphs.map((x) => [x.text, x.indentLeft, x.list?.format ?? null])).toEqual([
      ['引', '720', null],
      ['項目', null, 'bullet'],
      ['外', null, null],
    ]);
    expect(paragraphs[0].runs[0].bold).toBe(true);
  });

  it('keeps the bullet on a blockquote that opens a list item', async () => {
    const { paragraphs } = await readDocx(
      await toDocx(note('', ul(item({ type: 'blockquote', content: [p(text('甲')), p(text('乙'))] })))),
    );
    expect(paragraphs.map((x) => [x.text, x.list?.format ?? null, x.indentLeft])).toEqual([
      ['甲', 'bullet', null],
      ['乙', null, '720'],
    ]);
  });

  it('numbers the first real paragraph of an item even after an empty block', async () => {
    const { paragraphs } = await readDocx(
      await toDocx(note('', ul(item({ type: 'horizontalRule' }, p(text('第一段')))))),
    );
    expect(paragraphs.map((x) => [x.text, x.list?.format ?? null])).toEqual([['第一段', 'bullet']]);
  });

  it('drops characters XML 1.0 cannot hold, so Word can open the file', async () => {
    const blob = await toDocx(
      note(
        '標\u0001題',
        p(text('a\u000Bb\u0001c￾d\uD800e')),
        { type: 'callout', content: [p(text('x\u001Fy'))] },
      ),
    );
    const zip = await JSZip.loadAsync(blob);
    for (const path of ['word/document.xml', 'docProps/core.xml']) {
      const xml = await zip.file(path)!.async('string');
      const parsed = new DOMParser().parseFromString(xml, 'application/xml');
      expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
    }
    const { paragraphs, coreXml } = await readDocx(blob);
    expect(paragraphs.map((x) => x.text)).toEqual(['標題', 'abcde', 'xy']);
    expect(coreXml).toContain('<dc:title>標題</dc:title>');
  });

  it('writes links as Word hyperlinks to their href, and only text for unsafe links', async () => {
    const link = (href: string): Mark => ({ type: 'link', attrs: { href, target: '_blank' } });
    const blob = await toDocx(
      note(
        '',
        p(
          text('看 '),
          text('官網', link('https://example.com/a?b=1&c=2')),
          text(' 與 '),
          text('壞', link('javascript:alert(1)')),
        ),
      ),
    );
    const zip = await JSZip.loadAsync(blob);
    const documentXml = await zip.file('word/document.xml')!.async('string');
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
    expect(documentXml).toMatch(/<w:hyperlink [^>]*r:id="[^"]+"[^>]*>(?:(?!<\/w:hyperlink>)[\s\S])*官網/);
    expect(documentXml).not.toMatch(/<w:hyperlink [^>]*>(?:(?!<\/w:hyperlink>)[\s\S])*壞/);
    expect(rels).toContain('Target="https://example.com/a?b=1&amp;c=2"');
    expect(rels).not.toContain('javascript:');
    const { paragraphs } = await readDocx(blob);
    expect(paragraphs[0].text).toBe('看 官網 與 壞');
  });

  it('never writes a negative start number', async () => {
    const { paragraphs } = await readDocx(await toDocx(note('', ol(-3, item(p(text('一')))))));
    expect(paragraphs[0].list?.start).toBe('0');
  });
});

const task = (checked: boolean, ...content: JSONContent[]): JSONContent => ({
  type: 'taskItem',
  attrs: { checked },
  content,
});
const tasks = (...items: JSONContent[]): JSONContent => ({ type: 'taskList', content: items });

describe('toDocx task lists', () => {
  it('starts each task item with ☐ or ☑ instead of Word numbering', async () => {
    const { paragraphs } = await readDocx(
      await toDocx(note('', tasks(task(false, p(text('寄出報價單'))), task(true, p(text('預約會議室')))))),
    );
    expect(paragraphs.map((x) => [x.text, x.list, x.indentLeft])).toEqual([
      ['☐ 寄出報價單', null, '720'],
      ['☑ 預約會議室', null, '720'],
    ]);
  });

  it('keeps the marks of the item text after the box', async () => {
    const { paragraphs } = await readDocx(
      await toDocx(note('', tasks(task(false, p(text('重要', { type: 'bold' })))))),
    );
    expect(paragraphs[0]!.runs.map((r) => [r.text, r.bold])).toEqual([
      ['☐ ', false],
      ['重要', true],
    ]);
  });

  it('indents nested lists one level further', async () => {
    const { paragraphs } = await readDocx(
      await toDocx(
        note(
          '',
          tasks(task(false, p(text('準備')), tasks(task(true, p(text('訂場地')))), ul(item(p(text('帶投影機')))))),
        ),
      ),
    );
    expect(paragraphs.map((x) => [x.text, x.indentLeft, x.list?.format ?? null, x.list?.level ?? null])).toEqual([
      ['☐ 準備', '720', null, null],
      ['☑ 訂場地', '1080', null, null],
      ['帶投影機', null, 'bullet', 1],
    ]);
  });

  it('nests a task list inside a bullet list one level further', async () => {
    const { paragraphs } = await readDocx(
      await toDocx(note('', ul(item(p(text('專案')), tasks(task(false, p(text('寫測試')))))))),
    );
    expect(paragraphs.map((x) => [x.text, x.indentLeft, x.list?.level ?? null])).toEqual([
      ['專案', null, 0],
      ['☐ 寫測試', '1080', null],
    ]);
  });

  it('gives the box its own line once when an item does not start with a paragraph', async () => {
    const { paragraphs } = await readDocx(
      await toDocx(note('', tasks(task(true, { type: 'heading', attrs: { level: 2 }, content: [text('議程')] })))),
    );
    expect(paragraphs.map((x) => [x.text, x.indentLeft])).toEqual([
      ['☑', '720'],
      ['議程', '720'],
    ]);
  });
});
