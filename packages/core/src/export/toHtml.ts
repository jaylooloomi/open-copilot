import type { JSONContent, Note } from '@oc/shared';
import { generateHTML, getSchema } from '@tiptap/react';
import { createExtensions } from '../editor/extensions';
import { nodeText, TRANSCRIPT_GAP_TEXT, TRANSCRIPT_GAP_TYPE } from './common';

type Schema = ReturnType<typeof getSchema>;
type Extensions = ReturnType<typeof createExtensions>;

let cached: { extensions: Extensions; schema: Schema } | undefined;

/** Builds the editor extensions and schema once, on first export. */
function exportSetup(): { extensions: Extensions; schema: Schema } {
  if (!cached) {
    const extensions = createExtensions();
    cached = { extensions, schema: getSchema(extensions) };
  }
  return cached;
}

/** HTML fragment (`<h1>title</h1>` + the editor's own HTML) used by PDF printing and copying. */
export function toHtml(note: Note): string {
  const { extensions, schema } = exportSetup();
  const doc: JSONContent = {
    type: 'doc',
    content: sanitizeChildren(note.content.content ?? [], schema, false),
  };
  const body = generateHTML(doc, extensions);
  const title = note.title.trim();
  return title ? `<h1>${escapeHtml(title)}</h1>${body}` : body;
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Makes the JSON safe for generateHTML, which throws on node or mark types the schema lacks:
 * transcript gaps become `[未轉寫片段]`, unknown nodes become their text, unknown marks are dropped.
 */
function sanitizeChildren(
  children: JSONContent[],
  schema: Schema,
  inTextblock: boolean,
): JSONContent[] {
  const result: JSONContent[] = [];
  for (const child of children) {
    if (child.type === TRANSCRIPT_GAP_TYPE) {
      result.push({ type: 'text', text: TRANSCRIPT_GAP_TEXT });
      continue;
    }
    const type = child.type ? schema.nodes[child.type] : undefined;
    if (!type) {
      const text = nodeText(child);
      if (text === '') continue;
      const inline = linesToInline(text);
      if (inTextblock) result.push(...inline);
      else result.push({ type: 'paragraph', content: inline });
      continue;
    }
    if (child.type === 'text' && !child.text) continue;
    const clean: JSONContent = { ...child };
    if (child.type === 'heading') clean.attrs = { ...child.attrs, level: headingLevel(child.attrs?.level) };
    if (child.marks) clean.marks = child.marks.filter((mark) => schema.marks[mark.type]);
    if (child.content) clean.content = sanitizeChildren(child.content, schema, type.isTextblock);
    result.push(clean);
  }
  return result;
}

/** The editor allows heading levels 1-3; a malformed stored level is clamped into that range, as toDocx does. */
function headingLevel(level: unknown): 1 | 2 | 3 {
  return Math.min(Math.max(Math.trunc(Number(level)) || 1, 1), 3) as 1 | 2 | 3;
}

function linesToInline(text: string): JSONContent[] {
  const result: JSONContent[] = [];
  text.split('\n').forEach((line, index) => {
    if (index > 0) result.push({ type: 'hardBreak' });
    if (line !== '') result.push({ type: 'text', text: line });
  });
  return result;
}
