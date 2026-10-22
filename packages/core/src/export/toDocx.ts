import type { JSONContent, Note } from '@oc/shared';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  TextRun,
  type ILevelsOptions,
  type IParagraphOptions,
  type IRunOptions,
} from 'docx';
import { UNTITLED_NOTE } from '../notes/noteStore';
import { listStart, nodeText, TRANSCRIPT_GAP_TEXT, TRANSCRIPT_GAP_TYPE } from './common';

type Mark = NonNullable<JSONContent['marks']>[number];
type ParagraphFormat = Pick<IParagraphOptions, 'numbering' | 'indent'>;

const BULLET_REFERENCE = 'oc-bullet';
/** Yellow from the highlighter palette, used when a highlight mark has no colour. */
const DEFAULT_HIGHLIGHT = 'FEF08A';
const LEVELS = 9;
/** Left indent (twips) of each blockquote level. */
const QUOTE_INDENT = 720;
const BULLET_SYMBOLS = ['•', '◦', '▪'];
const ORDERED_FORMATS = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];

const HEADINGS = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
} as const;

const ALIGNMENTS = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;

interface Context {
  /** One numbering definition per ordered list, so every list starts counting again. */
  orderedLists: { reference: string; start: number }[];
}

/**
 * Word document keeping bold, italic, underline, strike-through, text colour, highlight (as run shading),
 * alignment, heading levels, bullet/numbered lists and indented blockquotes. The title becomes Word's Title style.
 */
export async function toDocx(note: Note): Promise<Blob> {
  const context: Context = { orderedLists: [] };
  const title = note.title.trim();
  const children: Paragraph[] = [];
  if (title) {
    children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] }));
  }
  for (const node of note.content.content ?? []) children.push(...renderBlock(node, context, {}));
  if (children.length === 0) children.push(new Paragraph({}));

  const doc = new Document({
    title: title || UNTITLED_NOTE,
    creator: 'open-copilot',
    numbering: {
      config: [
        { reference: BULLET_REFERENCE, levels: bulletLevels() },
        ...context.orderedLists.map(({ reference, start }) => ({
          reference,
          levels: orderedLevels(start),
        })),
      ],
    },
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}

function renderBlock(node: JSONContent, context: Context, format: ParagraphFormat): Paragraph[] {
  switch (node.type) {
    case 'paragraph':
      return [textParagraph(node, format)];
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 3) as 1 | 2 | 3;
      return [textParagraph(node, { ...format, heading: HEADINGS[level] })];
    }
    case 'bulletList':
    case 'orderedList':
      return renderList(node, context, 0);
    case 'blockquote':
      return renderBlockquote(node, context, format);
    default: {
      // Unknown block: its text content as a plain paragraph.
      const text = nodeText(node);
      return text === '' ? [] : [new Paragraph({ ...format, children: plainRuns(text) })];
    }
  }
}

/**
 * Quote children keep their own formatting, indented one step further. A list item's bullet or
 * number stays on the quote's first paragraph; nested lists keep their own numbering.
 */
function renderBlockquote(quote: JSONContent, context: Context, format: ParagraphFormat): Paragraph[] {
  const left = (Number(format.indent?.left) || 0) + QUOTE_INDENT;
  const paragraphs: Paragraph[] = [];
  let first = !!format.numbering;
  for (const child of quote.content ?? []) {
    const rendered = renderBlock(child, context, first ? format : { indent: { left } });
    if (rendered.length > 0) first = false;
    paragraphs.push(...rendered);
  }
  return paragraphs;
}

function renderList(list: JSONContent, context: Context, depth: number): Paragraph[] {
  const level = Math.min(depth, LEVELS - 1);
  let reference = BULLET_REFERENCE;
  if (list.type === 'orderedList') {
    reference = `oc-ordered-${context.orderedLists.length + 1}`;
    context.orderedLists.push({ reference, start: listStart(list) });
  }
  const paragraphs: Paragraph[] = [];
  for (const item of list.content ?? []) {
    let numbered = false;
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        paragraphs.push(...renderList(child, context, depth + 1));
        continue;
      }
      // The item's first paragraph carries the bullet/number; later ones only line up with it.
      const format: ParagraphFormat = numbered
        ? { indent: { left: levelIndent(level).left } }
        : { numbering: { reference, level } };
      const rendered = renderBlock(child, context, format);
      if (rendered.length > 0) numbered = true;
      paragraphs.push(...rendered);
    }
  }
  return paragraphs;
}

function textParagraph(node: JSONContent, options: IParagraphOptions): Paragraph {
  const alignment = ALIGNMENTS[node.attrs?.textAlign as keyof typeof ALIGNMENTS];
  return new Paragraph({
    ...options,
    ...(alignment ? { alignment } : {}),
    children: inlineRuns(node.content ?? []),
  });
}

function inlineRuns(nodes: JSONContent[]): TextRun[] {
  const runs: TextRun[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      if (node.text) runs.push(new TextRun({ text: node.text, ...runFormat(node.marks ?? []) }));
    } else if (node.type === 'hardBreak') {
      runs.push(new TextRun({ break: 1 }));
    } else if (node.type === TRANSCRIPT_GAP_TYPE) {
      runs.push(new TextRun(TRANSCRIPT_GAP_TEXT));
    } else {
      runs.push(...plainRuns(nodeText(node)));
    }
  }
  return runs;
}

function plainRuns(text: string): TextRun[] {
  return text
    .split('\n')
    .map((line, index) => new TextRun(index === 0 ? { text: line } : { text: line, break: 1 }));
}

function runFormat(marks: Mark[]): IRunOptions {
  const find = (type: string) => marks.find((mark) => mark.type === type);
  const color = toHexColor(find('textStyle')?.attrs?.color);
  const highlight = find('highlight');
  const fill = highlight ? (toHexColor(highlight.attrs?.color) ?? DEFAULT_HIGHLIGHT) : undefined;
  return {
    ...(find('bold') ? { bold: true } : {}),
    ...(find('italic') ? { italics: true } : {}),
    ...(find('underline') ? { underline: {} } : {}),
    ...(find('strike') ? { strike: true } : {}),
    ...(color ? { color } : {}),
    ...(fill ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill } } : {}),
  };
}

/** `#rgb`, `#rrggbb` or `rgb(r, g, b)` → `RRGGBB`; anything else (e.g. `red`) → undefined. */
function toHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const color = value.trim().toLowerCase();
  const long = /^#([0-9a-f]{6})$/.exec(color);
  if (long) return long[1].toUpperCase();
  const short = /^#([0-9a-f]{3})$/.exec(color);
  if (short) return [...short[1]].map((c) => c + c).join('').toUpperCase();
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/.exec(color);
  if (rgb) {
    return rgb
      .slice(1, 4)
      .map((n) => Math.min(Number(n), 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
  return undefined;
}

function levelIndent(level: number) {
  return { left: 720 + level * 360, hanging: 360 };
}

function bulletLevels(): ILevelsOptions[] {
  return Array.from({ length: LEVELS }, (_, level) => ({
    level,
    format: LevelFormat.BULLET,
    text: BULLET_SYMBOLS[level % BULLET_SYMBOLS.length],
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: levelIndent(level) } },
  }));
}

function orderedLevels(start: number): ILevelsOptions[] {
  return Array.from({ length: LEVELS }, (_, level) => ({
    level,
    format: ORDERED_FORMATS[level % ORDERED_FORMATS.length],
    text: `%${level + 1}.`,
    start,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: levelIndent(level) } },
  }));
}
