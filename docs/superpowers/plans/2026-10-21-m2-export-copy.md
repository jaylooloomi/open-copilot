# M2 四種匯出 + 複製 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓使用者從工具列右側一鍵「複製」整篇筆記（HTML + 純文字），或「匯出」成 Markdown、Word、純文字與 PDF（列印），並以行內狀態訊息回報成功或失敗。

**Architecture:** `packages/core/src/export/` 內每種格式一個純函式（`toMarkdown`／`toTxt`／`toDocx`／`toHtml`），共用 `common.ts` 處理未知節點、未轉寫片段與清單縮排；`exportNote` 依格式產生 Blob 後交給 `Platform.fileSaver`，PDF 則由 `printPdf` 以隱藏 iframe 呼叫 `print()`；`copyNote` 寫入剪貼簿。UI 端 `ExportMenu`（下拉選單）與 `NoteActions`（複製鈕 + 匯出選單 + 狀態訊息）放在 `Toolbar` 最右側，平台差異只透過 `usePlatform()`（`canPrint`、`fileSaver`）取得，core 內沒有任何平台判斷。

**Tech Stack:** TypeScript 5.9、React 19、Tiptap v3（`generateHTML`／`getSchema` 由 `@tiptap/react` 重新匯出）、docx 9、lucide-react 1.x、Vitest 3 + jsdom 26 + Testing Library、jszip（僅測試用，解開 .docx 驗證 XML）、Playwright。

---

## 前置條件

- 在 repo 根目錄 `D:\git\open-copilot` 以 **Git Bash** 執行所有指令。Node 24、npm 11。
- M1（`2026-10-21-m1-web-editor.md`）已全部完成並 commit。本計畫的「修改」步驟以 M1 計畫產出的檔案內容為準。
- 本計畫的程式碼已在本機以 M1 計畫的實際產出為基礎完整跑過：單元／元件測試、三個 workspace 的 typecheck、`vite build`、Playwright e2e（`--repeat-each=3`）。實際版本：docx 9.13.0、jszip 3.10.2、@tiptap/* 3.32.0、vitest 3.2.7、jsdom 26.1.0、@playwright/test 1.64.1。另外以 markdown-it 14（未加入專案）確認 Markdown 輸出的渲染結果，並以 Word 16 開啟產出的 .docx 確認標題、清單編號與顏色皆正確。

- [ ] **前置步驟 1：確認 M1 已完成**

Run: `npm test -w @oc/core`
Expected: `Test Files  18 passed (18)`、`Tests  87 passed (87)`。

Run: `ls packages/core/src/editor/Toolbar.tsx packages/core/src/NotesApp.tsx apps/web/e2e/notes.spec.ts`
Expected: 三個檔案都列出，沒有 `No such file or directory`。

- [ ] **前置步驟 2：commit 計畫文件**

Run: `git status --short`
Expected: 沒有輸出，或只有 `docs/superpowers/plans/` 底下的變動（例如本計畫檔 `?? docs/superpowers/plans/2026-10-21-m2-export-copy.md`，或勾選 checkbox 造成的修改）。若出現其他路徑，先停下來回報。

若有 `docs/superpowers/plans/` 的變動：

```bash
git add docs/superpowers/plans
git commit -m "docs: add M2 export and copy plan"
```

Run: `git status --short`
Expected: 沒有輸出。

## 與共用契約的關係（下游計畫必讀）

本計畫完全遵守 `2026-10-21-00-overview.md` 的 M2 簽章。以下是契約沒有寫死、由本計畫決定的細節，M3b／M4／M5 撰寫時請以此為準：

| 項目 | 決定 |
|---|---|
| `Toolbar` 介面 | 由 M1 的 `Toolbar({ editor })` 擴充為 `Toolbar({ editor, note }: { editor: TiptapEditor; note: Note })`。`NotesApp` 傳入 `note={activeNote}`。工具列最後一個子元素是 `<NoteActions note={note} />`。 |
| `NoteActions` | `editor/NoteActions.tsx`：`NoteActions({ note }: { note: Note })`，內部呼叫 `usePlatform()`，所以**任何渲染 `Toolbar` 的測試都必須包在 `PlatformProvider` 裡**（可用 `createTestPlatform()`）。 |
| `ExportMenu` | `editor/ExportMenu.tsx`：`ExportMenu({ canPrint, onSelect(format) })`；按鈕文字 `匯出`（`aria-haspopup="menu"`），選單 `role="menu"`、`aria-label="匯出格式"`，項目 `role="menuitem"`：`Markdown`、`Word`、`純文字`、`PDF`（`canPrint === false` 時不顯示 PDF）。 |
| `ExportFormat` | `export/filename.ts` 匯出 `type ExportFormat = 'md' \| 'docx' \| 'txt' \| 'pdf'`，`toFilename` 與 `exportNote` 共用。 |
| 狀態訊息 | `NoteActions` 內 `<span role="status" class="oc-action-status">`，3 秒（`STATUS_CLEAR_MS`）後自動清除。文字：`已複製全文`、`複製失敗，請再試一次`、`已匯出 Markdown`、`已匯出 Word`、`已匯出純文字`、`匯出失敗，請再試一次`。PDF 成功不顯示訊息（列印對話框本身就是回饋）。 |
| 使用者取消存檔 | `FileSaver` 介面不變（`save(): Promise<void>`）。約定：**使用者在存檔對話框／分享選單按取消時，`save` 以 `name === 'AbortError'` 的錯誤 reject**（例如 `new DOMException('使用者取消', 'AbortError')`），`NoteActions` 遇到它不顯示任何訊息；其他錯誤顯示「匯出失敗，請再試一次」；正常 resolve 顯示「已匯出 …」。M4 的 `desktopFileSaver`（`ocDesktop.saveFile` 回傳 `false`）與 M5 的 `capacitorFileSaver`（分享被取消）請照此約定。 |
| 未轉寫片段 | 所有匯出器以節點名稱 `'transcriptGap'`（`export/common.ts` 的 `TRANSCRIPT_GAP_TYPE`）辨識，一律輸出 `TRANSCRIPT_GAP_TEXT = '[未轉寫片段]'`。`toHtml` 在呼叫 `generateHTML` 之前就把它換成文字，所以 M3b 在 `createExtensions()` 加入 `TranscriptGap` 後，剪貼簿與 PDF 也不會出現「⚠ 第 N 段未轉寫・重試」。M3b 可直接 `import { TRANSCRIPT_GAP_TYPE } from '../export/common'` 當作 Node 的 `name`。 |
| 未知節點 | Markdown／純文字／Word 只認得 `paragraph`、`heading`、`bulletList`、`orderedList`、`listItem`、`text`、`hardBreak`、`transcriptGap`；其他節點（含 StarterKit 的 `blockquote`、`codeBlock`、`horizontalRule`，工具列沒有入口，只能經 Markdown 快捷輸入或貼上產生）依契約輸出其文字內容。`toHtml` 則保留 schema 認得的一切節點，只把 schema 不認得的節點換成文字。 |
| 其他 mark | Markdown／純文字／Word 只保留契約列出的格式；刪除線、行內程式碼、連結只保留文字。HTML（複製、PDF）由 `generateHTML` 照原樣輸出。 |
| Word 載入方式 | `exportNote` 以 `await import('./toDocx')` 動態載入，docx 套件成為獨立 chunk（約 365 kB），主 bundle 維持約 668 kB，`vite build` 不會出現 >1000 kB 警告。M4／M5 打包時保留 Vite 預設的動態 chunk 即可。 |
| 列印 iframe | `printPdf` 建立帶 `data-oc-print` 屬性的隱藏 iframe（`PRINT_FRAME_ATTRIBUTE`），寫入完整 HTML 文件後呼叫 `contentWindow.print()`，在該 window 的 `afterprint` 移除 iframe；下次列印前也會清掉殘留的 iframe。M4 需在 Electron 手動確認列印對話框可開啟。 |
| 測試輔助 | `packages/core/src/test/blob.ts`：`readBlobText(blob)`。jsdom 26 的 `Blob` 沒有 `text()`／`arrayBuffer()`，測試一律用它讀 Blob。 |
| 剪貼簿換行 | Windows 的剪貼簿把 `\n` 存成 `\r\n`；e2e 讀回剪貼簿時先換回 `\n` 再比對。 |

額外的**開發**依賴（不是執行期套件）：`packages/core` 的 `jszip`。docx 產出的 .docx 是 zip 檔，測試需要解開它讀 `word/document.xml`、`word/numbering.xml` 才能驗證格式；jszip 本來就是 docx 的依賴，版本一致，不增加執行期體積。執行期只新增契約列出的 `docx@^9`。

## File Structure

| 檔案 | 職責 |
|---|---|
| `packages/core/package.json`（修改） | 新增執行期依賴 `docx`、開發依賴 `jszip` |
| `packages/core/src/export/filename.ts` | `toFilename(title, ext)` 與 `ExportFormat` 型別 |
| `packages/core/src/export/common.ts` | 匯出器共用：未轉寫片段常數、`nodeText`（未知節點的文字）、`listStart`、`formatListItem`（清單標記與續行縮排） |
| `packages/core/src/export/toTxt.ts` | `toTxt(note)`：純文字 |
| `packages/core/src/export/toMarkdown.ts` | `toMarkdown(note)`：Markdown（含跳脫與 mark 合併） |
| `packages/core/src/export/toHtml.ts` | `toHtml(note)`：`<h1>` 標題 + `generateHTML`，先清理未知節點；`escapeHtml` |
| `packages/core/src/export/toDocx.ts` | `toDocx(note)`：以 docx 9 產生 Word Blob |
| `packages/core/src/export/printPdf.ts` | `printPdf(note)`：隱藏 iframe 列印 |
| `packages/core/src/export/exportNote.ts` | `exportNote(note, format, platform)`：依格式產檔並交給 `fileSaver`，PDF 走列印 |
| `packages/core/src/export/copyNote.ts` | `copyNote(note)`：寫入 HTML + 純文字，失敗改純文字 |
| `packages/core/src/test/blob.ts` | 測試輔助 `readBlobText(blob)` |
| `packages/core/src/editor/ExportMenu.tsx` | 「匯出」按鈕與格式下拉選單（鍵盤操作、點外面／Esc 關閉） |
| `packages/core/src/editor/NoteActions.tsx` | 「複製」鈕 + `ExportMenu` + 行內狀態訊息 |
| `packages/core/src/editor/Toolbar.tsx`（修改） | 新增 `note` prop，最右側渲染 `NoteActions` |
| `packages/core/src/NotesApp.tsx`（修改） | 把 `activeNote` 傳給 `Toolbar` |
| `packages/core/src/styles/app.css`（修改） | 複製／匯出按鈕、選單、狀態訊息樣式 |
| `packages/core/src/editor/Toolbar.test.tsx`（修改） | Harness 包上 `PlatformProvider` 並傳入 `note`；改驗證複製／匯出存在 |
| `packages/core/src/NotesApp.test.tsx`（修改） | 新增「從工具列匯出 Markdown」整合測試 |
| `apps/web/e2e/export.spec.ts` | 匯出下載、PDF 列印、複製、窄螢幕選單的端對端測試 |

每個 `*.ts(x)` 旁邊的 `*.test.ts(x)` 為其測試。

---

### Task 1: 匯出檔名 `toFilename`

**Files:**
- Create: `packages/core/src/export/filename.ts`
- Test: `packages/core/src/export/filename.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/export/filename.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { toFilename } from './filename';

describe('toFilename', () => {
  it('uses the trimmed title and the extension', () => {
    expect(toFilename('  週會紀錄  ', 'md')).toBe('週會紀錄.md');
    expect(toFilename('週會紀錄', 'docx')).toBe('週會紀錄.docx');
    expect(toFilename('週會紀錄', 'txt')).toBe('週會紀錄.txt');
    expect(toFilename('週會紀錄', 'pdf')).toBe('週會紀錄.pdf');
  });

  it('removes characters Windows does not allow in file names', () => {
    expect(toFilename('a\\b/c:d*e?f"g<h>i|j', 'md')).toBe('abcdefghij.md');
  });

  it('removes control characters', () => {
    expect(toFilename('a\u0000b\tc\u001fd\u007fe\u0085f', 'txt')).toBe('abcdef.txt');
  });

  it('keeps at most 80 characters, counting an emoji as one character', () => {
    expect(toFilename('字'.repeat(100), 'md')).toBe(`${'字'.repeat(80)}.md`);
    expect(toFilename('😀'.repeat(81), 'md')).toBe(`${'😀'.repeat(80)}.md`);
  });

  it('trims again after cutting so the name never ends with a space', () => {
    expect(toFilename(`${'a'.repeat(79)} b`, 'md')).toBe(`${'a'.repeat(79)}.md`);
  });

  it('falls back to 未命名筆記 when nothing usable is left', () => {
    expect(toFilename('', 'md')).toBe('未命名筆記.md');
    expect(toFilename('   ', 'docx')).toBe('未命名筆記.docx');
    expect(toFilename('???', 'pdf')).toBe('未命名筆記.pdf');
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/export/filename.test.ts`
Expected: FAIL，`Failed to resolve import "./filename" from "src/export/filename.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/export/filename.ts`：

```ts
import { UNTITLED_NOTE } from '../notes/noteStore';

export type ExportFormat = 'md' | 'docx' | 'txt' | 'pdf';

const MAX_NAME_LENGTH = 80;

/** Characters Windows forbids in file names, plus C0/C1 control characters. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/g;

export function toFilename(title: string, ext: ExportFormat): string {
  const cleaned = title.replace(FORBIDDEN, '').trim();
  // Array.from splits by code point, so an emoji is never cut in half.
  const name = Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join('').trim();
  return `${name || UNTITLED_NOTE}.${ext}`;
}
```

`Array.from` 以 code point 切字，80 字的上限不會把 emoji 切成半個；切完再 `trim()` 一次，避免檔名以空白結尾。空白標題沿用 M1 的 `UNTITLED_NOTE`（`未命名筆記`）。

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/export/filename.test.ts`
Expected: `Tests  6 passed (6)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/export/filename.ts packages/core/src/export/filename.test.ts
git commit -m "feat(core): add export filename helper"
```

---

### Task 2: 匯出共用輔助 `common.ts`

**Files:**
- Create: `packages/core/src/export/common.ts`
- Test: `packages/core/src/export/common.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/export/common.test.ts`：

```ts
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
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/export/common.test.ts`
Expected: FAIL，`Failed to resolve import "./common" from "src/export/common.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/export/common.ts`：

```ts
import type { JSONContent } from '@oc/shared';

/** Node name of an untranscribed recording segment (added to the editor in M3b). */
export const TRANSCRIPT_GAP_TYPE = 'transcriptGap';
/** What every exporter writes in place of a transcriptGap node. */
export const TRANSCRIPT_GAP_TEXT = '[未轉寫片段]';

const INLINE_TYPES = new Set(['text', 'hardBreak', TRANSCRIPT_GAP_TYPE]);

/**
 * Plain text of any node; exporters use it for nodes they do not know.
 * Inline children (text, hard breaks, gaps) are joined directly, block children with newlines.
 */
export function nodeText(node: JSONContent): string {
  if (node.type === 'hardBreak') return '\n';
  if (node.type === TRANSCRIPT_GAP_TYPE) return TRANSCRIPT_GAP_TEXT;
  if (typeof node.text === 'string') return node.text;
  const children = node.content ?? [];
  const inline = children.some((child) => INLINE_TYPES.has(child.type ?? ''));
  return children.map(nodeText).join(inline ? '' : '\n');
}

/** First number of an ordered list (Tiptap's `start` attribute, default 1). */
export function listStart(list: JSONContent): number {
  const start = Number(list.attrs?.start ?? 1);
  return Number.isInteger(start) ? start : 1;
}

/**
 * Puts a list marker in front of a list item's text and indents its following lines by the
 * marker's width, so nested lists and wrapped lines stay inside the item.
 */
export function formatListItem(marker: string, body: string): string {
  const indent = ' '.repeat(marker.length);
  return body
    .split('\n')
    .map((line, index) => {
      if (index === 0) return `${marker}${line}`.trimEnd();
      return line === '' ? '' : `${indent}${line}`;
    })
    .join('\n');
}
```

`nodeText` 是契約「未知節點輸出其文字內容」的唯一實作：子節點中有文字類（`text`／`hardBreak`／`transcriptGap`）就直接串接，否則視為區塊、以換行串接。`formatListItem` 讓 Markdown 與純文字共用同一套清單縮排（續行縮排 = 標記寬度，`10. ` 是 4 格）。

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/export/common.test.ts`
Expected: `Tests  8 passed (8)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/export/common.ts packages/core/src/export/common.test.ts
git commit -m "feat(core): add shared export helpers for unknown nodes and lists"
```

---

### Task 3: 純文字匯出 `toTxt`

**Files:**
- Create: `packages/core/src/export/toTxt.ts`
- Test: `packages/core/src/export/toTxt.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/export/toTxt.test.ts`：

```ts
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
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/export/toTxt.test.ts`
Expected: FAIL，`Failed to resolve import "./toTxt" from "src/export/toTxt.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/export/toTxt.ts`：

```ts
import type { JSONContent, Note } from '@oc/shared';
import { formatListItem, listStart, nodeText } from './common';

/**
 * Plain text: the title, a blank line, then one line per paragraph or list item.
 * Lists keep their `- ` / `1. ` markers; every other kind of formatting is dropped.
 */
export function toTxt(note: Note): string {
  const title = note.title.trim();
  const body = (note.content.content ?? [])
    .map(renderBlock)
    .join('\n')
    // Drop blank lines at both ends (e.g. the empty paragraph Tiptap keeps after a final list).
    .replace(/^\n+|\n+$/g, '');
  return [title, body].filter((part) => part !== '').join('\n\n');
}

function renderBlock(node: JSONContent): string {
  switch (node.type) {
    case 'bulletList':
    case 'orderedList':
      return renderList(node);
    default:
      // Paragraphs and headings are their inline text; unknown blocks are their text content.
      return nodeText(node);
  }
}

function renderList(list: JSONContent): string {
  const ordered = list.type === 'orderedList';
  const start = listStart(list);
  return (list.content ?? [])
    .map((item, index) => {
      const marker = ordered ? `${start + index}. ` : '- ';
      const body = (item.content ?? []).map(renderBlock).join('\n');
      return formatListItem(marker, body);
    })
    .join('\n');
}
```

每個段落／清單項目一行，使用者刻意留的空段落保留為空行；只去掉頭尾的空行（StarterKit v3 的 `TrailingNode` 會在清單或標題結尾後補一個空段落）。結果不帶結尾換行，直接當剪貼簿的純文字時不會多一行。

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/export/toTxt.test.ts`
Expected: `Tests  7 passed (7)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/export/toTxt.ts packages/core/src/export/toTxt.test.ts
git commit -m "feat(core): add plain text exporter"
```

---

### Task 4: Markdown 匯出 `toMarkdown`

**Files:**
- Create: `packages/core/src/export/toMarkdown.ts`
- Test: `packages/core/src/export/toMarkdown.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/export/toMarkdown.test.ts`：

```ts
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

  it('keeps a transcript gap literal when (…) follows it', () => {
    expect(toMarkdown(note('', p(text('前'), gap, text('(見附件)'))))).toBe(
      '前\\[未轉寫片段\\](見附件)\n',
    );
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/export/toMarkdown.test.ts`
Expected: FAIL，`Failed to resolve import "./toMarkdown" from "src/export/toMarkdown.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/export/toMarkdown.ts`：

```ts
import type { JSONContent, Note } from '@oc/shared';
import {
  formatListItem,
  listStart,
  nodeText,
  TRANSCRIPT_GAP_TEXT,
  TRANSCRIPT_GAP_TYPE,
} from './common';

type MdMark = 'underline' | 'bold' | 'italic';

/**
 * Nesting order, outermost first. Underline is outermost so `<u>` never sits between `**` / `*`
 * and the text they wrap. Text colour, highlight and every other mark are dropped.
 */
const MD_MARKS: readonly MdMark[] = ['underline', 'bold', 'italic'];
const OPEN: Record<MdMark, string> = { underline: '<u>', bold: '**', italic: '*' };
const CLOSE: Record<MdMark, string> = { underline: '</u>', bold: '**', italic: '*' };
const HARD_BREAK = '\\\n';

/** Splits text into leading spaces, the rest, and trailing spaces. */
const SPACE_EDGES = /^(\s*)([\s\S]*?)(\s*)$/u;
/**
 * Same, but also moves Unicode punctuation and symbols to the edges. CommonMark only lets `**` / `*`
 * open or close next to punctuation when the other side is a space or punctuation too, so
 * `**重點：**內容` would stay literal; `**重點**：內容` works.
 */
const PUNCTUATION_EDGES = /^([\s\p{P}\p{S}]*)([\s\S]*?)([\s\p{P}\p{S}]*)$/u;

/**
 * Markdown: `# title`, body headings one level lower (`##`–`####`), `**bold**`, `*italic*`,
 * `<u>underline</u>`, `- ` / `1. ` lists. Colour, highlight and alignment are dropped.
 */
export function toMarkdown(note: Note): string {
  const blocks = renderBlocks(note.content.content ?? []);
  const title = note.title.trim();
  if (title) blocks.unshift(`# ${escapeHeadingEnd(escapeInline(title))}`);
  return blocks.length > 0 ? `${blocks.join('\n\n')}\n` : '';
}

function renderBlocks(nodes: JSONContent[]): string[] {
  return nodes.map(renderBlock).filter((block) => block !== '');
}

function renderBlock(node: JSONContent): string {
  switch (node.type) {
    case 'paragraph':
      return finishLines(renderInline(node.content));
    case 'heading': {
      // ATX headings are one line, so hard breaks become spaces.
      const text = escapeHeadingEnd(
        finishLines(renderInline(node.content)).replaceAll(HARD_BREAK, ' '),
      );
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 5);
      return text ? `${'#'.repeat(level + 1)} ${text}` : '';
    }
    case 'bulletList':
    case 'orderedList':
      return renderList(node);
    default:
      // Unknown block: its text content, one paragraph per line.
      return nodeText(node)
        .split('\n')
        .map((line) => finishLines(escapeInline(line)))
        .filter((line) => line !== '')
        .join('\n\n');
  }
}

function renderList(list: JSONContent): string {
  const ordered = list.type === 'orderedList';
  const start = listStart(list);
  return (list.content ?? [])
    .map((item, index) => {
      const marker = ordered ? `${start + index}. ` : '- ';
      let body = '';
      for (const child of item.content ?? []) {
        const block = renderBlock(child);
        if (block === '') continue;
        if (body !== '') body += canInterruptParagraph(child, block) ? '\n' : '\n\n';
        body += block;
      }
      return formatListItem(marker, body);
    })
    .join('\n');
}

function isList(node: JSONContent): boolean {
  return node.type === 'bulletList' || node.type === 'orderedList';
}

/**
 * Whether a rendered block may start on the line right after a paragraph in the same list item.
 * Only a list may, and CommonMark lets it interrupt a paragraph only when it is a bullet list or
 * starts at 1, and its first item is not empty (a lone `-` would turn the paragraph into a heading).
 */
function canInterruptParagraph(node: JSONContent, block: string): boolean {
  if (!isList(node)) return false;
  if (node.type === 'orderedList' && listStart(node) !== 1) return false;
  return !/^(?:-|\d+\.)$/.test(block.split('\n', 1)[0]);
}

/**
 * Renders inline content, opening and closing delimiters only where the set of marks changes.
 * Spaces (and, around `**` / `*`, punctuation) at the edges of a text node are written outside the
 * delimiters, so every `**` / `*` touches a letter and CommonMark accepts it.
 */
function renderInline(nodes: JSONContent[] = []): string {
  let out = '';
  let open: MdMark[] = [];
  /** Escaped spaces and punctuation to write between the next closing and opening delimiters. */
  let pending = '';

  const setMarks = (wanted: MdMark[]) => {
    let keep = 0;
    while (keep < open.length && keep < wanted.length && open[keep] === wanted[keep]) keep += 1;
    for (let i = open.length - 1; i >= keep; i -= 1) out += CLOSE[open[i]];
    out += pending;
    pending = '';
    for (let i = keep; i < wanted.length; i += 1) out += OPEN[wanted[i]];
    open = wanted;
  };

  for (const node of nodes) {
    if (node.type === 'text') {
      const marks = MD_MARKS.filter((mark) => node.marks?.some((m) => m.type === mark));
      const edges = marks.some((mark) => mark !== 'underline') ? PUNCTUATION_EDGES : SPACE_EDGES;
      // Escape first: an escape such as `\*` is two punctuation characters, so it is never split.
      const [, lead, core, trail] = edges.exec(escapeInline(node.text ?? '')) ?? ['', '', '', ''];
      pending += lead;
      if (core === '') continue;
      setMarks(marks);
      out += core;
      pending = trail;
    } else if (node.type === 'hardBreak') {
      setMarks([]);
      out += HARD_BREAK;
    } else if (node.type === TRANSCRIPT_GAP_TYPE) {
      setMarks([]);
      // Escaped so that a following `(…)` or `[…]` cannot turn it into a link.
      out += escapeInline(TRANSCRIPT_GAP_TEXT);
    } else {
      setMarks([]);
      out += escapeInline(nodeText(node)).replaceAll('\n', HARD_BREAK);
    }
  }
  setMarks([]);
  return out;
}

/**
 * Backslash-escapes characters that would otherwise start Markdown or HTML syntax, and an `&` that
 * would start an entity reference (`&copy;` would render as ©).
 */
function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]<~]|&(?=#?[0-9A-Za-z]+;)/g, '\\$&');
}

/** A run of `#` at the end of an ATX heading, after a space or alone, is read as its closing sequence. */
function escapeHeadingEnd(text: string): string {
  return text.replace(/(^|[ \t])(#+)$/, '$1\\$2');
}

/**
 * Removes leading/trailing spaces and hard breaks, strips each line's leading spaces and escapes
 * characters that would turn a line into a heading, quote or list.
 */
function finishLines(inline: string): string {
  return inline
    .replace(/^(?:[ \t]|\\\n)+/, '')
    .replace(/(?:[ \t]|\\\n)+$/, '')
    .split('\n')
    .map((line) =>
      line
        .replace(/^[ \t]+/, '')
        .replace(/^([#>+=-])/, '\\$1')
        .replace(/^(\d{1,9})([.)])/, '$1\\$2'),
    )
    .join('\n');
}
```

設計重點（皆已用 markdown-it 14 渲染確認；另以 3000 組隨機的「中文／標點／符號 × 粗斜底線組合」比對渲染結果，除了下面第 3 點刻意移出的邊緣標點外，每個字的格式都與筆記一致）：
- mark 依固定順序（底線 → 粗 → 斜）巢狀，只在 mark 集合改變時開關分隔符，所以「粗」接「粗斜」輸出 `**a*b***c`，渲染為 `<strong>a<em>b</em></strong>c`，不會出現 `**a****…` 這種壞掉的語法。底線（`<u>`）放最外層：CommonMark 規定 `**`／`*` 若一側緊鄰標點（`<`、`>` 也算），另一側就必須是空白或標點才能成立，所以 `前***<u>全</u>***後` 會原樣顯示星號，改成 `前<u>***全***</u>後` 才正確。
- 文字前後的空白移到分隔符外面：`** world **` 在 CommonMark 不算粗體。
- 有粗體或斜體的文字，前後的標點與符號（Unicode `P`／`S` 類，含全形「：」「」「。」與 emoji）也移到分隔符外面，讓每個 `**`／`*` 都緊貼文字：`**重點：**內容`、`內容**「重點」**` 在 markdown-it、VS Code 預覽與 GitHub 都會原樣顯示星號，改輸出 `**重點**：內容`、`內容「**重點**」` 就正確。代價是這些邊緣標點本身不再是粗／斜體，視覺差異極小。只有底線的文字不需要（`<u>` 是 HTML，不受這條規則限制），標點留在 `<u>` 裡。
- 使用者文字裡的反斜線、反引號、`*`、`_`、`[`、`]`、`<`、`~` 一律加反斜線；後面接得成字元參照（`&copy;`、`&#169;`）的 `&` 也加反斜線，否則 `&copy;` 會渲染成 ©（`Q&A` 不受影響）。先跳脫整段文字再切邊緣標點：跳脫序列（如 `\*`）兩個字元都是標點，不會被切開。
- 行首的 `#`、`>`、`+`、`=`、`-` 與 `1.`／`1)` 也跳脫，避免一般段落被誤判成標題、引言或清單。標題與內文標題結尾「空白 + `#`」（或整個標題就是 `#`）會被 CommonMark 當成結尾標記吃掉（`# Issue #` 渲染為「Issue」），所以結尾的 `#` 串也加反斜線（`# Issue \#`）；`C#` 前面沒有空白，不受影響。
- 未轉寫片段輸出 `\[未轉寫片段\]`，渲染結果就是契約的 `[未轉寫片段]`。不跳脫的話，後面緊接 `(見附件)` 會變成連結，段首的 `[未轉寫片段]: …` 會變成連結定義，讓其他片段都變成連結。
- 清單項目裡，段落之後的子清單通常只隔一個換行；但 CommonMark 不允許「起始號碼不是 1 的編號清單」或「第一項是空的清單」接在段落下一行（前者被併入段落，後者的 `-` 會把段落變成 `<h2>`），這兩種情況改隔一個空行（`- b\n\n  3. c`）。在空項目按 Tab、或打 `3. ` 開新清單就會產生這兩種結構。
- 硬換行（Shift+Enter）輸出 CommonMark 的 `\` + 換行；標題是單行語法，硬換行改成空白；段落結尾的硬換行直接捨去。
- 檔案以單一換行結尾；完全空白的筆記回傳空字串。

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/export/toMarkdown.test.ts`
Expected: `Tests  17 passed (17)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/export/toMarkdown.ts packages/core/src/export/toMarkdown.test.ts
git commit -m "feat(core): add Markdown exporter"
```

---

### Task 5: HTML 匯出 `toHtml`

**Files:**
- Create: `packages/core/src/export/toHtml.ts`
- Test: `packages/core/src/export/toHtml.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/export/toHtml.test.ts`：

```ts
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
});

describe('escapeHtml', () => {
  it('escapes the five HTML-sensitive characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/export/toHtml.test.ts`
Expected: FAIL，`Failed to resolve import "./toHtml" from "src/export/toHtml.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/export/toHtml.ts`：

```ts
import type { JSONContent, Note } from '@oc/shared';
import { generateHTML, getSchema } from '@tiptap/react';
import { createExtensions } from '../editor/extensions';
import { nodeText, TRANSCRIPT_GAP_TEXT, TRANSCRIPT_GAP_TYPE } from './common';

type Schema = ReturnType<typeof getSchema>;

/** HTML fragment (`<h1>title</h1>` + the editor's own HTML) used by PDF printing and copying. */
export function toHtml(note: Note): string {
  const extensions = createExtensions();
  const schema = getSchema(extensions);
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
    if (child.marks) clean.marks = child.marks.filter((mark) => schema.marks[mark.type]);
    if (child.content) clean.content = sanitizeChildren(child.content, schema, type.isTextblock);
    result.push(clean);
  }
  return result;
}

function linesToInline(text: string): JSONContent[] {
  const result: JSONContent[] = [];
  text.split('\n').forEach((line, index) => {
    if (index > 0) result.push({ type: 'hardBreak' });
    if (line !== '') result.push({ type: 'text', text: line });
  });
  return result;
}
```

`generateHTML` 與 `getSchema` 都從 `@tiptap/react` 匯入（它 `export * from '@tiptap/core'`），和 M1 取 `Extensions` 型別的做法一致，不需新增 `@tiptap/html`。`generateHTML` 遇到 schema 沒有的節點或 mark 會丟 `Unknown node type`，所以先清理：未轉寫片段換成文字、未知節點換成其文字（在段落內為行內文字，在區塊位置為新段落）、未知 mark 移除、空字串文字節點移除。標題用 `<h1>`，內文標題不降級（Heading 的 `levels` 只有 1–3，改成 4 會被渲染回 `<h1>`）。

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/export/toHtml.test.ts`
Expected: `Tests  7 passed (7)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/export/toHtml.ts packages/core/src/export/toHtml.test.ts
git commit -m "feat(core): add HTML exporter for printing and copying"
```

---

### Task 6: Word 匯出 `toDocx`

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/src/export/toDocx.ts`
- Test: `packages/core/src/export/toDocx.test.ts`

- [ ] **Step 1: 加入 docx 與 jszip 並安裝**

`packages/core/package.json` 改成（只多了 `dependencies.docx` 與 `devDependencies.jszip`）：

```json
{
  "name": "@oc/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@oc/shared": "*",
    "@tiptap/extension-highlight": "^3.32.0",
    "@tiptap/extension-text-align": "^3.32.0",
    "@tiptap/extension-text-style": "^3.32.0",
    "@tiptap/extensions": "^3.32.0",
    "@tiptap/pm": "^3.32.0",
    "@tiptap/react": "^3.32.0",
    "@tiptap/starter-kit": "^3.32.0",
    "docx": "^9.13.0",
    "idb": "^8.0.4",
    "lucide-react": "^1.60.0",
    "react": "^19.3.1",
    "react-dom": "^19.3.1"
  },
  "devDependencies": {
    "@testing-library/dom": "^10.4.2",
    "@testing-library/jest-dom": "^6.10.0",
    "@testing-library/react": "^16.3.3",
    "@testing-library/user-event": "^14.6.8",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^5.2.0",
    "fake-indexeddb": "^6.2.6",
    "jsdom": "^26.1.0",
    "jszip": "^3.10.2"
  }
}
```

Run: `npm install`
Expected: 成功，新增約 19 個套件（docx 與其依賴 jszip、nanoid 等）；`package-lock.json` 更新。

- [ ] **Step 2: 寫失敗的測試**

測試把產出的 Blob 用 jszip 解開，以 jsdom 的 `DOMParser` 解析 `word/document.xml`、`word/numbering.xml`、`docProps/core.xml`，再整理成「段落樣式／對齊／清單格式與起始值／每個 run 的粗斜底線、字色、底色」比對，不依賴 docx 內部的 XML 屬性順序或編號 ID。

`packages/core/src/export/toDocx.test.ts`：

```ts
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
});
```

- [ ] **Step 3: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/export/toDocx.test.ts`
Expected: FAIL，`Failed to resolve import "./toDocx" from "src/export/toDocx.test.ts". Does the file exist?`

- [ ] **Step 4: 實作**

`packages/core/src/export/toDocx.ts`：

```ts
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
 * Word document keeping bold, italic, underline, text colour, highlight (as run shading),
 * alignment, heading levels and bullet/numbered lists. The title becomes Word's Title style.
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
    default: {
      // Unknown block: its text content as a plain paragraph.
      const text = nodeText(node);
      return text === '' ? [] : [new Paragraph({ ...format, children: plainRuns(text) })];
    }
  }
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
      paragraphs.push(...renderBlock(child, context, format));
      numbered = true;
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
```

使用的都是 docx v9 文件化的穩定 API：`Document({ title, creator, numbering: { config }, sections })`、`Paragraph({ heading, alignment, numbering: { reference, level }, indent, children })`、`TextRun({ text, bold, italics, underline: {}, color, shading, break })`、`Packer.toBlob()`。重點：
- 螢光筆依契約用 run shading（`ShadingType.CLEAR` + `fill`），不用 Word 的 `highlight`（只有 16 種固定顏色）。顏色接受 `#rgb`、`#rrggbb`、`rgb()`（貼上的內容可能是 `rgb()`），其他字串（如 `red`）直接忽略。
- 每個編號清單各自一份 numbering 定義（`oc-ordered-1`、`oc-ordered-2`…），起始值取自 Tiptap 的 `start`，所以中間隔了段落的第二個清單會從頭（或從 `start`）開始編號；項目清單共用 `oc-bullet`。巢狀層級 = 清單深度（0–8）。
- 清單項目的第二段起不再帶編號，只縮排對齊。
- 已用 Word 16 開啟產出檔確認：標題為「標題」樣式、內文標題為「標題 1–3」、項目符號 `•`／`◦`、編號 `1.`／`a.`、第二個編號清單從 `3.` 開始、字色與螢光底色正確。

- [ ] **Step 5: 執行測試與型別檢查，確認通過**

Run: `npm test -w @oc/core -- src/export/toDocx.test.ts && npm run typecheck -w @oc/core`
Expected: `Tests  10 passed (10)`；typecheck 無錯誤。

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json package-lock.json packages/core/src/export/toDocx.ts packages/core/src/export/toDocx.test.ts
git commit -m "feat(core): add Word exporter using docx"
```

---

### Task 7: PDF 列印 `printPdf`

**Files:**
- Create: `packages/core/src/export/printPdf.ts`
- Test: `packages/core/src/export/printPdf.test.ts`

- [ ] **Step 1: 寫失敗的測試**

jsdom 沒有實作 `window.print`（呼叫只會在 console 印出 `Not implemented`），而 iframe 的 window 是另一個 realm，無法事先 spy。測試改為攔截 `document.body.appendChild`：iframe 一掛上就把它 window 的 `print` 換成記錄器（jsdom 的 `print` 是可寫的 own property），並在「被呼叫的當下」記下 iframe 文件的標題、內文與樣式。

`packages/core/src/export/printPdf.test.ts`：

```ts
import type { JSONContent, Note } from '@oc/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRINT_FRAME_ATTRIBUTE, printPdf } from './printPdf';

const note = (title: string, ...content: JSONContent[]): Note => ({
  id: 'n1',
  title,
  content: { type: 'doc', content },
  createdAt: 1,
  updatedAt: 1,
});
const p = (value: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });

const frames = () => Array.from(document.querySelectorAll<HTMLIFrameElement>(`iframe[${PRINT_FRAME_ATTRIBUTE}]`));

/**
 * jsdom does not implement window.print (it only logs "Not implemented"). Swap in a spy on every
 * iframe as soon as it is attached, and record what the frame shows when print() is called, plus
 * the tab title at that moment (Chrome names the saved PDF after it).
 */
function stubFramePrint() {
  const printed: { title: string; tabTitle: string; body: string; css: string }[] = [];
  const print = vi.fn();
  const append = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
    const result = append(node);
    if (node instanceof HTMLIFrameElement) {
      const frameWindow = node.contentWindow!;
      frameWindow.print = () => {
        const doc = node.contentDocument!;
        printed.push({
          title: doc.title,
          tabTitle: document.title,
          body: doc.body.innerHTML,
          css: doc.querySelector('style')?.textContent ?? '',
        });
        print();
      };
    }
    return result;
  });
  return { print, printed };
}

const afterPrint = (frame: HTMLIFrameElement) => frame.contentWindow!.dispatchEvent(new Event('afterprint'));

beforeEach(() => {
  document.title = 'open-copilot';
});

afterEach(() => {
  vi.restoreAllMocks();
  frames().forEach((frame) => frame.remove());
});

describe('printPdf', () => {
  it('prints the note from a hidden iframe, with the tab titled after the note', () => {
    const { print, printed } = stubFramePrint();
    printPdf(note('週會 <紀錄>', p('第一點')));

    expect(print).toHaveBeenCalledTimes(1);
    expect(printed[0].title).toBe('週會 <紀錄>');
    expect(printed[0].tabTitle).toBe('週會 <紀錄>');
    expect(printed[0].body).toBe('<h1>週會 &lt;紀錄&gt;</h1><p>第一點</p>');
    expect(printed[0].css).toContain('print-color-adjust: exact');

    const [frame] = frames();
    expect(frame).toHaveAttribute('aria-hidden', 'true');
    expect(frame.style.width).toBe('0px');
    expect(frame.style.height).toBe('0px');
  });

  it('uses 未命名筆記 as the title for an untitled note', () => {
    const { printed } = stubFramePrint();
    printPdf(note('', p('內文')));
    expect(printed[0].title).toBe('未命名筆記');
    expect(printed[0].tabTitle).toBe('未命名筆記');
    expect(printed[0].body).toBe('<p>內文</p>');
  });

  it('removes the iframe and restores the tab title after printing', () => {
    stubFramePrint();
    printPdf(note('A', p('a')));
    expect(document.title).toBe('A');

    afterPrint(frames()[0]);

    expect(frames()).toHaveLength(0);
    expect(document.title).toBe('open-copilot');
  });

  it('cleans up a print whose afterprint never fired before printing again', () => {
    const { print, printed } = stubFramePrint();
    printPdf(note('A', p('a')));
    printPdf(note('B', p('b')));

    expect(print).toHaveBeenCalledTimes(2);
    expect(printed[1].tabTitle).toBe('B');
    expect(frames()).toHaveLength(1);

    afterPrint(frames()[0]);
    expect(document.title).toBe('open-copilot');
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/export/printPdf.test.ts`
Expected: FAIL，`Failed to resolve import "./printPdf" from "src/export/printPdf.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/export/printPdf.ts`：

```ts
import type { Note } from '@oc/shared';
import { displayTitle } from '../notes/noteStore';
import { escapeHtml, toHtml } from './toHtml';

/** Marks the hidden print frame so a leftover one can be found and removed. */
export const PRINT_FRAME_ATTRIBUTE = 'data-oc-print';

const PRINT_CSS = `
@page { margin: 2cm; }
body {
  margin: 0;
  color: #111827;
  font-family: system-ui, -apple-system, 'Segoe UI', 'Noto Sans TC', 'PingFang TC',
    'Microsoft JhengHei', sans-serif;
  font-size: 12pt;
  line-height: 1.7;
}
h1 { font-size: 22pt; margin: 0 0 12pt; }
h2 { font-size: 18pt; margin: 16pt 0 8pt; }
h3 { font-size: 15pt; margin: 14pt 0 6pt; }
h4 { font-size: 13pt; margin: 12pt 0 6pt; }
p { margin: 0 0 6pt; }
ul, ol { margin: 0 0 6pt; padding-left: 1.5em; }
li > p { margin: 0; }
mark { padding: 0 1px; border-radius: 2px; }
/* Browsers skip background colours when printing unless told otherwise. */
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;

/** Puts the tab title back; set while a print started by printPdf has not finished. */
let restoreTitle: (() => void) | undefined;

/**
 * Prints the note from a hidden iframe so the browser's print dialog can save it as PDF.
 * Only call it when `platform.canPrint` is true (Android WebView has no window.print).
 */
export function printPdf(note: Note): void {
  // A print whose `afterprint` never fired: put the tab title back and drop its frame.
  restoreTitle?.();
  document.querySelectorAll(`iframe[${PRINT_FRAME_ATTRIBUTE}]`).forEach((frame) => frame.remove());

  const iframe = document.createElement('iframe');
  iframe.setAttribute(PRINT_FRAME_ATTRIBUTE, '');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  // Not display:none / visibility:hidden: some browsers then print an empty page.
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);

  const frameWindow = iframe.contentWindow;
  const frameDocument = iframe.contentDocument;
  if (!frameWindow || !frameDocument) {
    iframe.remove();
    throw new Error('Print frame is not available');
  }

  frameDocument.open();
  frameDocument.write(printDocument(note));
  frameDocument.close();

  // Chrome names the saved PDF after the tab (top-level document) title, not the iframe's <title>.
  const previousTitle = document.title;
  document.title = displayTitle(note);
  restoreTitle = () => {
    document.title = previousTitle;
    restoreTitle = undefined;
  };

  frameWindow.addEventListener(
    'afterprint',
    () => {
      restoreTitle?.();
      iframe.remove();
    },
    { once: true },
  );
  frameWindow.print();
}

function printDocument(note: Note): string {
  return [
    '<!doctype html>',
    '<html lang="zh-Hant-TW">',
    '<head>',
    '<meta charset="utf-8">',
    // Kept for browsers that name the PDF after the printed frame; Chrome uses the tab title.
    `<title>${escapeHtml(displayTitle(note))}</title>`,
    `<style>${PRINT_CSS}</style>`,
    '</head>',
    `<body>${toHtml(note)}</body>`,
    '</html>',
  ].join('');
}
```

- `afterprint` 監聽器必須在 `document.open()`／`write()`／`close()` **之後**才註冊：`document.open()` 會清掉該 window 上既有的事件監聽器。已在 Playwright 的 Chromium 實測：真正呼叫 `print()` 後 `afterprint` 觸發、iframe 被移除。
- iframe 用 0×0 而不是 `display:none`／`visibility:hidden`，避免部分瀏覽器印出空白頁。
- `print-color-adjust: exact` 讓螢光筆底色印得出來（瀏覽器列印預設不印背景色）。
- Chrome「另存為 PDF」的預設檔名取自**分頁標題**（最上層 `document.title`，本 app 是 `open-copilot`），不是 iframe 的 `<title>`（以 Chrome for Testing 156 + `--kiosk-printing` 實測：上層標題 `TOPTITLE`、iframe 標題 `IFRAMETITLE` 時存成 `TOPTITLE.pdf`；照本實作暫換上層標題後存成筆記標題）。所以 `printPdf` 在呼叫 `print()` 前把 `document.title` 暫時換成筆記標題（空白時為「未命名筆記」），在 `afterprint` 換回原標題；若上一次列印的 `afterprint` 沒有觸發，下次列印一開始就先換回，不會把筆記標題誤當成「原標題」記住。iframe 的 `<title>` 仍保留，給以列印文件標題命名的瀏覽器使用。

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/export/printPdf.test.ts`
Expected: `Tests  4 passed (4)`；輸出中沒有 `Not implemented: window.print`。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/export/printPdf.ts packages/core/src/export/printPdf.test.ts
git commit -m "feat(core): print notes to PDF through a hidden iframe"
```

---

### Task 8: 匯出分派 `exportNote`

**Files:**
- Create: `packages/core/src/test/blob.ts`
- Create: `packages/core/src/export/exportNote.ts`
- Test: `packages/core/src/export/exportNote.test.ts`

- [ ] **Step 1: 建立測試輔助（Task 8、9、12 共用）**

`packages/core/src/test/blob.ts`：

```ts
/** jsdom's Blob has no text()/arrayBuffer(), so tests read blobs through FileReader. */
export function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}
```

- [ ] **Step 2: 寫失敗的測試**

`printPdf` 以 `vi.mock` 取代（它的行為已由 Task 7 測過），這裡只驗證分派；`fileSaver` 用 M1 的 `createTestPlatform()`（方法皆為 `vi.fn`）。

`packages/core/src/export/exportNote.test.ts`：

```ts
import type { Note } from '@oc/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBlobText } from '../test/blob';
import { createTestPlatform } from '../test/memoryStorage';
import { exportNote } from './exportNote';
import { printPdf } from './printPdf';
import { toMarkdown } from './toMarkdown';
import { toTxt } from './toTxt';

vi.mock('./printPdf', () => ({ printPdf: vi.fn() }));

const NOTE: Note = {
  id: 'n1',
  title: '週會/紀錄',
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一點', marks: [{ type: 'bold' }] }] }],
  },
  createdAt: 1,
  updatedAt: 1,
};

afterEach(() => {
  vi.mocked(printPdf).mockReset();
});

describe('exportNote', () => {
  it('saves Markdown as <title>.md', async () => {
    const { platform, fileSaver } = createTestPlatform();
    await exportNote(NOTE, 'md', platform);

    expect(fileSaver.save).toHaveBeenCalledTimes(1);
    const [filename, blob] = fileSaver.save.mock.calls[0];
    expect(filename).toBe('週會紀錄.md');
    expect(blob.type).toBe('text/markdown;charset=utf-8');
    expect(await readBlobText(blob)).toBe(toMarkdown(NOTE));
  });

  it('saves plain text as <title>.txt', async () => {
    const { platform, fileSaver } = createTestPlatform();
    await exportNote(NOTE, 'txt', platform);

    const [filename, blob] = fileSaver.save.mock.calls[0];
    expect(filename).toBe('週會紀錄.txt');
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(await readBlobText(blob)).toBe(toTxt(NOTE));
  });

  it('saves a Word document as <title>.docx', async () => {
    const { platform, fileSaver } = createTestPlatform();
    await exportNote(NOTE, 'docx', platform);

    const [filename, blob] = fileSaver.save.mock.calls[0];
    expect(filename).toBe('週會紀錄.docx');
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('names untitled notes 未命名筆記', async () => {
    const { platform, fileSaver } = createTestPlatform();
    await exportNote({ ...NOTE, title: '' }, 'md', platform);
    expect(fileSaver.save.mock.calls[0][0]).toBe('未命名筆記.md');
  });

  it('prints for PDF instead of saving a file', async () => {
    const { platform, fileSaver } = createTestPlatform();
    await exportNote(NOTE, 'pdf', platform);

    expect(printPdf).toHaveBeenCalledWith(NOTE);
    expect(fileSaver.save).not.toHaveBeenCalled();
  });

  it('refuses PDF when the platform cannot print', async () => {
    const { platform } = createTestPlatform();
    await expect(exportNote(NOTE, 'pdf', { ...platform, canPrint: false })).rejects.toThrow(
      'PDF export is not available on this platform',
    );
    expect(printPdf).not.toHaveBeenCalled();
  });

  it('passes FileSaver failures on to the caller', async () => {
    const { platform, fileSaver } = createTestPlatform();
    fileSaver.save.mockRejectedValueOnce(new Error('disk full'));
    await expect(exportNote(NOTE, 'md', platform)).rejects.toThrow('disk full');
  });
});
```

- [ ] **Step 3: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/export/exportNote.test.ts`
Expected: FAIL，`Failed to resolve import "./exportNote" from "src/export/exportNote.test.ts". Does the file exist?`

- [ ] **Step 4: 實作**

`packages/core/src/export/exportNote.ts`：

```ts
import type { Note } from '@oc/shared';
import type { Platform } from '../platform/types';
import { toFilename, type ExportFormat } from './filename';
import { printPdf } from './printPdf';
import { toMarkdown } from './toMarkdown';
import { toTxt } from './toTxt';

/** Builds the file for `format` and hands it to the platform's FileSaver; PDF goes through printing. */
export async function exportNote(note: Note, format: ExportFormat, platform: Platform): Promise<void> {
  switch (format) {
    case 'md':
      await platform.fileSaver.save(
        toFilename(note.title, 'md'),
        new Blob([toMarkdown(note)], { type: 'text/markdown;charset=utf-8' }),
      );
      return;
    case 'txt':
      await platform.fileSaver.save(
        toFilename(note.title, 'txt'),
        new Blob([toTxt(note)], { type: 'text/plain;charset=utf-8' }),
      );
      return;
    case 'docx': {
      // The docx library is ~400 kB; load it only when someone exports to Word.
      const { toDocx } = await import('./toDocx');
      await platform.fileSaver.save(toFilename(note.title, 'docx'), await toDocx(note));
      return;
    }
    case 'pdf':
      if (!platform.canPrint) throw new Error('PDF export is not available on this platform');
      printPdf(note);
      return;
  }
}
```

`toDocx` 以動態 `import()` 載入：docx 套件約 365 kB（gzip 約 107 kB），靜態引入會讓主 bundle 超過 1000 kB 而觸發 `vite build` 的警告；拆成獨立 chunk 後只有第一次匯出 Word 時才下載。Vitest 對動態 import 的處理與靜態相同。Markdown／純文字的 Blob 帶 `charset=utf-8`，中文在各平台都能正確開啟。

- [ ] **Step 5: 執行測試與型別檢查，確認通過**

Run: `npm test -w @oc/core -- src/export/exportNote.test.ts && npm run typecheck -w @oc/core`
Expected: `Tests  7 passed (7)`；typecheck 無錯誤。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/test/blob.ts packages/core/src/export/exportNote.ts packages/core/src/export/exportNote.test.ts
git commit -m "feat(core): add exportNote dispatcher"
```

---

### Task 9: 複製全文 `copyNote`

**Files:**
- Create: `packages/core/src/export/copyNote.ts`
- Test: `packages/core/src/export/copyNote.test.ts`

- [ ] **Step 1: 寫失敗的測試**

jsdom 沒有 `navigator.clipboard` 也沒有 `ClipboardItem`：測試以 `vi.stubGlobal` 裝上假的 `ClipboardItem`（保留收到的 Blob），以 `Object.defineProperty` 裝上假的 `navigator.clipboard`，結束時移除。

`packages/core/src/export/copyNote.test.ts`：

```ts
import type { Note } from '@oc/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readBlobText } from '../test/blob';
import { copyNote } from './copyNote';

const NOTE: Note = {
  id: 'n1',
  title: '週會',
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一點', marks: [{ type: 'bold' }] }] }],
  },
  createdAt: 1,
  updatedAt: 1,
};

/** jsdom has no ClipboardItem; this fake keeps the blobs it was given. */
class FakeClipboardItem {
  constructor(readonly items: Record<string, Blob>) {}
}

function installClipboard(clipboard: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
}

beforeEach(() => {
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
});

afterEach(() => {
  vi.unstubAllGlobals();
  // jsdom has no navigator.clipboard of its own; drop the one a test installed.
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('copyNote', () => {
  it('writes HTML and plain text in one clipboard item', async () => {
    const write = vi.fn(async (_items: ClipboardItems) => undefined);
    const writeText = vi.fn(async (_text: string) => undefined);
    installClipboard({ write, writeText });

    await copyNote(NOTE);

    expect(writeText).not.toHaveBeenCalled();
    const [[items]] = write.mock.calls;
    expect(items).toHaveLength(1);
    const { items: blobs } = items[0] as unknown as FakeClipboardItem;
    expect(Object.keys(blobs).sort()).toEqual(['text/html', 'text/plain']);
    expect(await readBlobText(blobs['text/html'])).toBe('<h1>週會</h1><p><strong>第一點</strong></p>');
    expect(await readBlobText(blobs['text/plain'])).toBe('週會\n\n第一點');
  });

  it('falls back to plain text when the rich write is refused', async () => {
    const write = vi.fn(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    const writeText = vi.fn(async (_text: string) => undefined);
    installClipboard({ write, writeText });

    await copyNote(NOTE);

    expect(writeText).toHaveBeenCalledWith('週會\n\n第一點');
  });

  it('uses plain text directly when ClipboardItem is not supported', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    const write = vi.fn(async () => undefined);
    const writeText = vi.fn(async (_text: string) => undefined);
    installClipboard({ write, writeText });

    await copyNote(NOTE);

    expect(write).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith('週會\n\n第一點');
  });

  it('rejects when plain text cannot be written either', async () => {
    installClipboard({
      write: vi.fn(async () => {
        throw new Error('rich failed');
      }),
      writeText: vi.fn(async () => {
        throw new Error('plain failed');
      }),
    });
    await expect(copyNote(NOTE)).rejects.toThrow('plain failed');
  });

  it('rejects when there is no clipboard at all', async () => {
    installClipboard(undefined);
    await expect(copyNote(NOTE)).rejects.toThrow('Clipboard API is not available');
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/export/copyNote.test.ts`
Expected: FAIL，`Failed to resolve import "./copyNote" from "src/export/copyNote.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/export/copyNote.ts`：

```ts
import type { Note } from '@oc/shared';
import { toHtml } from './toHtml';
import { toTxt } from './toTxt';

/**
 * Copies the whole note: rich HTML plus plain text when the browser allows it,
 * otherwise plain text only. Rejects when the clipboard cannot be written at all.
 */
export async function copyNote(note: Note): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard) throw new Error('Clipboard API is not available');
  const text = toTxt(note);

  if (typeof clipboard.write === 'function' && typeof ClipboardItem === 'function') {
    try {
      await clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([toHtml(note)], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return;
    } catch {
      // Rich copy can be refused (permissions, unsupported types); fall back to plain text.
    }
  }
  await clipboard.writeText(text);
}
```

`toHtml` 放在 `try` 裡：就算 HTML 產生失敗，也會退回純文字。剪貼簿完全不可用（非安全來源、權限被拒且 `writeText` 也失敗）時 reject，由 UI 顯示「複製失敗」。

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/export/copyNote.test.ts`
Expected: `Tests  5 passed (5)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/export/copyNote.ts packages/core/src/export/copyNote.test.ts
git commit -m "feat(core): copy notes as rich HTML with plain text fallback"
```

---

### Task 10: 匯出下拉選單 `ExportMenu`

**Files:**
- Create: `packages/core/src/editor/ExportMenu.tsx`
- Test: `packages/core/src/editor/ExportMenu.test.tsx`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/editor/ExportMenu.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExportMenu } from './ExportMenu';

function setup(canPrint = true) {
  const onSelect = vi.fn();
  render(
    <div>
      <ExportMenu canPrint={canPrint} onSelect={onSelect} />
      <p>outside</p>
    </div>,
  );
  return { onSelect, user: userEvent.setup(), button: screen.getByRole('button', { name: '匯出' }) };
}

const itemNames = () => screen.getAllByRole('menuitem').map((item) => item.textContent);

describe('ExportMenu', () => {
  it('starts closed', () => {
    const { button } = setup();
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens a menu of Markdown, Word, 純文字 and PDF with the first item focused', async () => {
    const { user, button } = setup();
    await user.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: '匯出格式' })).toBeInTheDocument();
    expect(itemNames()).toEqual(['Markdown', 'Word', '純文字', 'PDF']);
    expect(screen.getByRole('menuitem', { name: 'Markdown' })).toHaveFocus();
  });

  it('hides PDF when the platform cannot print', async () => {
    const { user, button } = setup(false);
    await user.click(button);
    expect(itemNames()).toEqual(['Markdown', 'Word', '純文字']);
  });

  it('reports the chosen format, closes and returns focus to the button', async () => {
    const { user, button, onSelect } = setup();
    await user.click(button);
    await user.click(screen.getByRole('menuitem', { name: 'Word' }));

    expect(onSelect).toHaveBeenCalledWith('docx');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('moves with the arrow keys and selects with Enter', async () => {
    const { user, button, onSelect } = setup();
    await user.click(button);

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Word' })).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'PDF' })).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: '純文字' })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('txt');
  });

  it('closes on Escape, Tab and an outside click without choosing', async () => {
    const { user, button, onSelect } = setup();
    await user.click(button);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    await user.click(button);
    await user.tab();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(button);
    await user.click(screen.getByText('outside'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/editor/ExportMenu.test.tsx`
Expected: FAIL，`Failed to resolve import "./ExportMenu" from "src/editor/ExportMenu.test.tsx". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/editor/ExportMenu.tsx`：

```tsx
import { ChevronDown, Download } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ExportFormat } from '../export/filename';

export const EXPORT_OPTIONS: readonly { format: ExportFormat; label: string }[] = [
  { format: 'md', label: 'Markdown' },
  { format: 'docx', label: 'Word' },
  { format: 'txt', label: '純文字' },
  { format: 'pdf', label: 'PDF' },
];

export interface ExportMenuProps {
  /** false hides the PDF item (Platform.canPrint). */
  canPrint: boolean;
  onSelect(format: ExportFormat): void;
}

/** 匯出 button with a dropdown menu of formats. */
export function ExportMenu({ canPrint, onSelect }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const options = EXPORT_OPTIONS.filter((option) => canPrint || option.format !== 'pdf');

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const closeAndFocusButton = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndFocusButton();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="oc-export" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="oc-action-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Download size={16} aria-hidden="true" />
        <span>匯出</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          className="oc-export-menu"
          role="menu"
          aria-label="匯出格式"
          onKeyDown={onMenuKeyDown}
        >
          {options.map((option) => (
            <button
              key={option.format}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="oc-export-item"
              onClick={() => {
                closeAndFocusButton();
                onSelect(option.format);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

依 WAI-ARIA menu button 模式：開啟時焦點移到第一項，↑／↓ 循環移動，Enter（原生 button）選取，Esc 關閉並把焦點還給「匯出」鈕，Tab 離開時關閉；點選單外面也關閉（與 M1 的 `ColorPalette` 相同，用 `mousedown`）。選單項目 `tabIndex={-1}`，Tab 鍵不會在項目間停留。

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/editor/ExportMenu.test.tsx`
Expected: `Tests  6 passed (6)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/editor/ExportMenu.tsx packages/core/src/editor/ExportMenu.test.tsx
git commit -m "feat(core): add export format dropdown menu"
```

---

### Task 11: 複製與匯出動作 `NoteActions`

**Files:**
- Create: `packages/core/src/editor/NoteActions.tsx`
- Test: `packages/core/src/editor/NoteActions.test.tsx`

- [ ] **Step 1: 寫失敗的測試**

`copyNote`／`exportNote` 以 `vi.mock` 取代（行為已由 Task 8、9 測過），這裡只驗證接線與狀態訊息。訊息自動清除的測試改用假計時器 + `fireEvent`（M1 已記錄：Testing Library 的 `waitFor` 與 user-event 在 Vitest 假計時器下會卡住），用 `await act(async () => {})` 讓 `copyNote` 的 promise 完成。

`packages/core/src/editor/NoteActions.test.tsx`：

```tsx
import { EMPTY_DOC, type Note } from '@oc/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyNote } from '../export/copyNote';
import { exportNote } from '../export/exportNote';
import { PlatformProvider } from '../platform/PlatformContext';
import { createTestPlatform } from '../test/memoryStorage';
import { NoteActions, STATUS_CLEAR_MS } from './NoteActions';

vi.mock('../export/copyNote', () => ({ copyNote: vi.fn() }));
vi.mock('../export/exportNote', () => ({ exportNote: vi.fn() }));

const NOTE: Note = { id: 'n1', title: '週會', content: EMPTY_DOC, createdAt: 1, updatedAt: 1 };

function setup({ canPrint = true } = {}) {
  const { platform: base } = createTestPlatform();
  const platform = { ...base, canPrint };
  render(
    <PlatformProvider platform={platform}>
      <NoteActions note={NOTE} />
    </PlatformProvider>,
  );
  return { platform, user: userEvent.setup() };
}

async function exportAs(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('button', { name: '匯出' }));
  await user.click(screen.getByRole('menuitem', { name: label }));
}

afterEach(() => {
  vi.mocked(copyNote).mockReset();
  vi.mocked(exportNote).mockReset();
  vi.useRealTimers();
});

describe('NoteActions', () => {
  it('shows 複製 and 匯出 with an empty status region', () => {
    setup();
    expect(screen.getByRole('button', { name: '複製' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '匯出' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('copies the note and says so', async () => {
    vi.mocked(copyNote).mockResolvedValue();
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: '複製' }));

    expect(copyNote).toHaveBeenCalledWith(NOTE);
    expect(screen.getByRole('status')).toHaveTextContent('已複製全文');
  });

  it('reports a failed copy', async () => {
    vi.mocked(copyNote).mockRejectedValue(new Error('denied'));
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: '複製' }));

    expect(screen.getByRole('status')).toHaveTextContent('複製失敗，請再試一次');
  });

  it.each([
    ['Markdown', 'md', '已匯出 Markdown'],
    ['Word', 'docx', '已匯出 Word'],
    ['純文字', 'txt', '已匯出純文字'],
  ])('exports %s through the platform and confirms it', async (label, format, message) => {
    vi.mocked(exportNote).mockResolvedValue();
    const { user, platform } = setup();
    await exportAs(user, label);

    expect(exportNote).toHaveBeenCalledWith(NOTE, format, platform);
    expect(screen.getByRole('status')).toHaveTextContent(message);
  });

  it('starts PDF printing without a status message', async () => {
    vi.mocked(exportNote).mockResolvedValue();
    const { user, platform } = setup();
    await exportAs(user, 'PDF');

    expect(exportNote).toHaveBeenCalledWith(NOTE, 'pdf', platform);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('offers no PDF when the platform cannot print', async () => {
    const { user } = setup({ canPrint: false });
    await user.click(screen.getByRole('button', { name: '匯出' }));
    expect(screen.queryByRole('menuitem', { name: 'PDF' })).not.toBeInTheDocument();
  });

  it('reports a failed export', async () => {
    vi.mocked(exportNote).mockRejectedValue(new Error('disk full'));
    const { user } = setup();
    await exportAs(user, 'Word');

    expect(screen.getByRole('status')).toHaveTextContent('匯出失敗，請再試一次');
  });

  it('stays quiet when the user cancels the save dialog', async () => {
    vi.mocked(exportNote).mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    const { user } = setup();
    await exportAs(user, 'Markdown');

    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it(`clears the message after ${STATUS_CLEAR_MS} ms`, async () => {
    vi.useFakeTimers();
    vi.mocked(copyNote).mockResolvedValue();
    setup();

    fireEvent.click(screen.getByRole('button', { name: '複製' }));
    await act(async () => {}); // let copyNote's promise settle
    expect(screen.getByRole('status')).toHaveTextContent('已複製全文');

    act(() => vi.advanceTimersByTime(STATUS_CLEAR_MS - 1));
    expect(screen.getByRole('status')).toHaveTextContent('已複製全文');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toHaveTextContent('');
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/editor/NoteActions.test.tsx`
Expected: FAIL，`Failed to resolve import "./NoteActions" from "src/editor/NoteActions.test.tsx". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/editor/NoteActions.tsx`：

```tsx
import type { Note } from '@oc/shared';
import { Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { copyNote } from '../export/copyNote';
import { exportNote } from '../export/exportNote';
import type { ExportFormat } from '../export/filename';
import { usePlatform } from '../platform/PlatformContext';
import { ExportMenu } from './ExportMenu';

/** How long a status message stays visible. */
export const STATUS_CLEAR_MS = 3000;

export const ACTION_MESSAGES = {
  copied: '已複製全文',
  copyFailed: '複製失敗，請再試一次',
  exported: { md: '已匯出 Markdown', docx: '已匯出 Word', txt: '已匯出純文字' },
  exportFailed: '匯出失敗，請再試一次',
} as const;

/** 複製 and 匯出 on the right of the toolbar, with an inline status message. */
export function NoteActions({ note }: { note: Note }) {
  const platform = usePlatform();
  const [status, setStatus] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const show = (message: string) => {
    clearTimeout(timer.current);
    setStatus(message);
    if (message) timer.current = setTimeout(() => setStatus(''), STATUS_CLEAR_MS);
  };

  const copy = async () => {
    try {
      await copyNote(note);
      show(ACTION_MESSAGES.copied);
    } catch {
      show(ACTION_MESSAGES.copyFailed);
    }
  };

  const runExport = async (format: ExportFormat) => {
    try {
      await exportNote(note, format, platform);
      // PDF ends in the browser's print dialog, which is its own feedback.
      show(format === 'pdf' ? '' : ACTION_MESSAGES.exported[format]);
    } catch (error) {
      // A FileSaver throws AbortError when the user cancels its dialog: not a failure.
      show(isAbortError(error) ? '' : ACTION_MESSAGES.exportFailed);
    }
  };

  return (
    <div className="oc-note-actions">
      <span className="oc-action-status" role="status">
        {status}
      </span>
      <button type="button" className="oc-action-btn" onClick={() => void copy()}>
        <Copy size={16} aria-hidden="true" />
        <span>複製</span>
      </button>
      <ExportMenu canPrint={platform.canPrint} onSelect={(format) => void runExport(format)} />
    </div>
  );
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}
```

`role="status"` 的元素一直存在（內容可為空），螢幕閱讀器才會朗讀之後填入的訊息。`isAbortError` 用鴨子型別判斷 `name`，`DOMException` 與一般 `Error` 都適用（見「與共用契約的關係」的取消約定）。

- [ ] **Step 4: 執行測試與型別檢查，確認通過**

Run: `npm test -w @oc/core -- src/editor/NoteActions.test.tsx && npm run typecheck -w @oc/core`
Expected: `Tests  11 passed (11)`；typecheck 無錯誤。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/editor/NoteActions.tsx packages/core/src/editor/NoteActions.test.tsx
git commit -m "feat(core): add copy and export actions with status messages"
```

---

### Task 12: 工具列接上複製／匯出（含端對端測試）

**Files:**
- Modify: `packages/core/src/editor/Toolbar.tsx`
- Modify: `packages/core/src/NotesApp.tsx`
- Modify: `packages/core/src/styles/app.css`
- Modify: `packages/core/src/editor/Toolbar.test.tsx`
- Modify: `packages/core/src/NotesApp.test.tsx`
- Test: `apps/web/e2e/export.spec.ts`

- [ ] **Step 1: 寫失敗的端對端測試**

Playwright 預設接受下載；`download.path()` 等下載完成後回傳暫存檔路徑。PDF 測試把列印 iframe 的 `print()` 換成記錄器，不開對話框；複製測試先授予剪貼簿權限，讀回時把 Windows 的 `\r\n` 換回 `\n`。

`apps/web/e2e/export.spec.ts`：

```ts
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/** Fills in a note with a title and two body paragraphs, the second one bold. */
async function writeNote(page: Page) {
  await page.getByRole('textbox', { name: '標題' }).fill('週會紀錄');
  await page.getByRole('textbox', { name: '筆記內文' }).click();
  await page.keyboard.type('第一點');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+B');
  await page.keyboard.type('重要');
}

async function exportAs(page: Page, label: string) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出' }).click();
  await page.getByRole('menuitem', { name: label }).click();
  return download;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: '標題' })).toBeVisible();
  await writeNote(page);
});

test('匯出 Markdown 下載 <標題>.md', async ({ page }) => {
  const download = await exportAs(page, 'Markdown');
  expect(download.suggestedFilename()).toBe('週會紀錄.md');
  expect(await readFile(await download.path(), 'utf8')).toBe('# 週會紀錄\n\n第一點\n\n**重要**\n');
  await expect(page.getByRole('status')).toHaveText('已匯出 Markdown');
});

test('匯出純文字與 Word', async ({ page }) => {
  const txt = await exportAs(page, '純文字');
  expect(txt.suggestedFilename()).toBe('週會紀錄.txt');
  expect(await readFile(await txt.path(), 'utf8')).toBe('週會紀錄\n\n第一點\n重要');

  const docx = await exportAs(page, 'Word');
  expect(docx.suggestedFilename()).toBe('週會紀錄.docx');
  const bytes = await readFile(await docx.path());
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK'); // a .docx is a zip file
  await expect(page.getByRole('status')).toHaveText('已匯出 Word');
});

/** What the stubbed print() saw: the frame's title and body, and the tab title. */
type Printed = { title: string; tabTitle: string; body: string };

test('匯出 PDF 把筆記交給隱藏 iframe 列印', async ({ page }) => {
  await expect(page).toHaveTitle('open-copilot');
  // Replace print() on the print iframe so no dialog opens; record what it would print.
  await page.evaluate(() => {
    const w = window as unknown as { printed?: Printed };
    const append = document.body.appendChild.bind(document.body);
    document.body.appendChild = <T extends Node>(node: T): T => {
      const result = append(node);
      if (node instanceof HTMLIFrameElement) {
        node.contentWindow!.print = () => {
          w.printed = {
            title: node.contentDocument!.title,
            // Chrome names the saved PDF after the tab title, so it must be the note title here.
            tabTitle: document.title,
            body: node.contentDocument!.body.innerHTML,
          };
        };
      }
      return result;
    };
  });

  await page.getByRole('button', { name: '匯出' }).click();
  await page.getByRole('menuitem', { name: 'PDF' }).click();

  const printed = () => page.evaluate(() => (window as unknown as { printed?: Printed }).printed);
  await expect.poll(async () => (await printed())?.title).toBe('週會紀錄');
  expect((await printed())?.tabTitle).toBe('週會紀錄');
  expect((await printed())?.body).toBe('<h1>週會紀錄</h1><p>第一點</p><p><strong>重要</strong></p>');

  // The stub never fires afterprint; fire it the way the browser does when the dialog closes.
  await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('iframe[data-oc-print]')!;
    frame.contentWindow!.dispatchEvent(new Event('afterprint'));
  });
  await expect(page).toHaveTitle('open-copilot');
  await expect(page.locator('iframe[data-oc-print]')).toHaveCount(0);
});

test('複製全文寫入剪貼簿', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: '複製' }).click();

  await expect(page.getByRole('status')).toHaveText('已複製全文');
  const copied = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    return {
      types: item.types,
      html: await (await item.getType('text/html')).text(),
      // The Windows clipboard stores line breaks as CRLF.
      text: (await navigator.clipboard.readText()).replaceAll('\r\n', '\n'),
    };
  });
  expect(copied.types).toEqual(expect.arrayContaining(['text/html', 'text/plain']));
  expect(copied.html).toContain('<h1>週會紀錄</h1>');
  expect(copied.html).toContain('<strong>重要</strong>');
  expect(copied.text).toBe('週會紀錄\n\n第一點\n重要');
});

test('窄螢幕時匯出選單完整顯示在畫面內', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '匯出' }).click();

  const menu = page.getByRole('menu', { name: '匯出格式' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Markdown', 'Word', '純文字', 'PDF']);
  const box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});
```

- [ ] **Step 2: 執行端對端測試，確認失敗**

Run: `npm run e2e -w @oc/web -- e2e/export.spec.ts`
Expected: `5 failed`，每個都是 `Test timeout of 30000ms exceeded`，等待 `getByRole('button', { name: '匯出' })`（4 個）或 `getByRole('button', { name: '複製' })`（1 個）——工具列還沒有這兩顆按鈕。約需 40 秒。若出現 `Executable doesn't exist`，先執行 `npm exec -w @oc/web -- playwright install chromium`。

- [ ] **Step 3: 更新工具列測試**

`Toolbar` 新增必填的 `note` prop，且 `NoteActions` 需要 `PlatformProvider`。把 `packages/core/src/editor/Toolbar.test.tsx` **從第一行到第一個測試 `it('renders every M1 control and no copy/export buttons', ...)` 結束的 `});` 為止**整段換成下面內容（第一個測試改名並改為驗證複製／匯出；其後 7 個測試完全不變）：

```tsx
import type { JSONContent, Note } from '@oc/shared';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PlatformProvider } from '../platform/PlatformContext';
import { createTestPlatform } from '../test/memoryStorage';
import { Editor } from './Editor';
import { Toolbar } from './Toolbar';
import { useNoteEditor } from './useNoteEditor';

const CONTENT: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
};
const NOTE: Note = { id: 'n1', title: '測試', content: CONTENT, createdAt: 1, updatedAt: 1 };

function Harness({ editorRef }: { editorRef: { current: TiptapEditor | null } }) {
  const editor = useNoteEditor({
    noteId: NOTE.id,
    content: NOTE.content,
    onChange: () => undefined,
  });
  editorRef.current = editor;
  return (
    <>
      <Toolbar editor={editor} note={NOTE} />
      <Editor editor={editor} />
    </>
  );
}

function setup() {
  const editorRef = { current: null as TiptapEditor | null };
  const { platform } = createTestPlatform();
  render(
    <PlatformProvider platform={platform}>
      <Harness editorRef={editorRef} />
    </PlatformProvider>,
  );
  const editor = editorRef.current as TiptapEditor;
  // Select "Hello world" (positions 1..12 inside the first paragraph).
  act(() => {
    editor.commands.setTextSelection({ from: 1, to: 12 });
  });
  return { editor, user: userEvent.setup() };
}

const button = (name: string) => screen.getByRole('button', { name });

describe('Toolbar', () => {
  it('renders every formatting control, then 複製 and 匯出 at the end', () => {
    setup();
    const toolbar = screen.getByRole('toolbar', { name: '格式工具列' });
    for (const name of [
      '復原', '重做', '粗體', '斜體', '底線', '字色', '螢光筆',
      '靠左', '置中', '靠右', '項目清單', '編號清單',
    ]) {
      expect(button(name)).toBeInTheDocument();
    }
    expect(screen.getByRole('combobox', { name: '段落樣式' })).toHaveValue('paragraph');
    const buttons = within(toolbar).getAllByRole('button');
    expect(buttons.slice(-2).map((b) => b.textContent)).toEqual(['複製', '匯出']);
  });
```

- [ ] **Step 4: 新增 `NotesApp` 整合測試**

在 `packages/core/src/NotesApp.test.tsx` 的 import 區，於 `import { createTestPlatform } from './test/memoryStorage';` 這一行**之前**加入：

```tsx
import { readBlobText } from './test/blob';
```

並在 `describe('NotesApp', () => { ... })` 內、最後一個測試 `it('opens and closes the note drawer from the menu button', ...)` 之後（檔案最後一行 `});` 之前）加入：

```tsx
  it('exports the active note, with its latest title, as Markdown', async () => {
    const { user, fileSaver } = await renderApp([note('a', 'A', 'Alpha', 1)]);
    await user.clear(titleInput());
    await user.type(titleInput(), '週會');

    await user.click(screen.getByRole('button', { name: '匯出' }));
    await user.click(screen.getByRole('menuitem', { name: 'Markdown' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已匯出 Markdown'));
    expect(fileSaver.save).toHaveBeenCalledTimes(1);
    const [filename, blob] = fileSaver.save.mock.calls[0];
    expect(filename).toBe('週會.md');
    expect(await readBlobText(blob)).toBe('# 週會\n\nAlpha\n');
  });
```

這個測試不 mock 任何匯出函式：先改標題再匯出，確認工具列拿到的是最新的 `activeNote`，並經由真正的 `exportNote` → `toMarkdown` → `fileSaver.save` 產出檔案。

- [ ] **Step 5: 執行元件測試，確認失敗**

Run: `npm test -w @oc/core -- src/editor/Toolbar.test.tsx src/NotesApp.test.tsx`
Expected: FAIL，`Tests  2 failed | 16 passed (18)`：
- `Toolbar > renders every formatting control, then 複製 and 匯出 at the end`：`AssertionError: expected [ '', '' ] to deeply equal [ '複製', '匯出' ]`
- `NotesApp > exports the active note, with its latest title, as Markdown`：`Unable to find an accessible element with the role "button" and name "匯出"`

- [ ] **Step 6: 修改 `Toolbar`**

`packages/core/src/editor/Toolbar.tsx` 完整內容（相對 M1 只有三處：import `Note` 型別與 `NoteActions`、函式簽章加上 `note`、最後一個 `.oc-tool-group` 之後渲染 `<NoteActions note={note} />`）：

```tsx
import type { Note } from '@oc/shared';
import { useEditorState, type Editor as TiptapEditor } from '@tiptap/react';
import {
  Baseline,
  Bold,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Redo2,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Underline,
  Undo2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { ColorPalette } from './ColorPalette';
import { NoteActions } from './NoteActions';
import { HIGHLIGHT_COLORS, TEXT_COLORS } from './palettes';

type BlockStyle = 'paragraph' | 'h1' | 'h2' | 'h3';
type Align = 'left' | 'center' | 'right';

const BLOCK_OPTIONS: { value: BlockStyle; label: string }[] = [
  { value: 'paragraph', label: '正文' },
  { value: 'h1', label: '標題 1' },
  { value: 'h2', label: '標題 2' },
  { value: 'h3', label: '標題 3' },
];

const HEADING_LEVEL = { h1: 1, h2: 2, h3: 3 } as const;

const ICON_SIZE = 18;

function currentBlock(editor: TiptapEditor): BlockStyle {
  if (editor.isActive('heading', { level: 1 })) return 'h1';
  if (editor.isActive('heading', { level: 2 })) return 'h2';
  if (editor.isActive('heading', { level: 3 })) return 'h3';
  return 'paragraph';
}

function currentAlign(editor: TiptapEditor): Align {
  if (editor.isActive({ textAlign: 'center' })) return 'center';
  if (editor.isActive({ textAlign: 'right' })) return 'right';
  return 'left';
}

function ToolButton(props: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={props.active ? 'oc-tool is-active' : 'oc-tool'}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.active}
      disabled={props.disabled}
      // Keep the editor's selection while clicking toolbar buttons.
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function Toolbar({ editor, note }: { editor: TiptapEditor; note: Note }) {
  const state = useEditorState({
    editor,
    // Read the prop, not the snapshot: after useEditor recreates the editor (note switch),
    // useEditorState keeps handing out the previous, destroyed editor until the next transaction.
    selector: () => ({
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
      block: currentBlock(editor),
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      color: editor.getAttributes('textStyle').color as string | undefined,
      highlight: editor.getAttributes('highlight').color as string | undefined,
      align: currentAlign(editor),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
    }),
  });

  const chain = () => editor.chain().focus();

  const setBlock = (value: BlockStyle) => {
    if (value === 'paragraph') chain().setParagraph().run();
    else chain().setHeading({ level: HEADING_LEVEL[value] }).run();
  };

  const setAlign = (align: Align) => chain().setTextAlign(align).run();

  return (
    <div className="oc-toolbar" role="toolbar" aria-label="格式工具列">
      <div className="oc-tool-group">
        <ToolButton label="復原" disabled={!state.canUndo} onClick={() => chain().undo().run()}>
          <Undo2 size={ICON_SIZE} />
        </ToolButton>
        <ToolButton label="重做" disabled={!state.canRedo} onClick={() => chain().redo().run()}>
          <Redo2 size={ICON_SIZE} />
        </ToolButton>
      </div>

      <div className="oc-tool-group">
        <select
          className="oc-block-select"
          aria-label="段落樣式"
          value={state.block}
          onChange={(event) => setBlock(event.target.value as BlockStyle)}
        >
          {BLOCK_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="oc-tool-group">
        <ToolButton label="粗體" active={state.bold} onClick={() => chain().toggleBold().run()}>
          <Bold size={ICON_SIZE} />
        </ToolButton>
        <ToolButton label="斜體" active={state.italic} onClick={() => chain().toggleItalic().run()}>
          <Italic size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="底線"
          active={state.underline}
          onClick={() => chain().toggleUnderline().run()}
        >
          <Underline size={ICON_SIZE} />
        </ToolButton>
        <ColorPalette
          label="字色"
          icon={<Baseline size={ICON_SIZE} />}
          colors={TEXT_COLORS}
          current={state.color}
          onPick={(color) => chain().setColor(color).run()}
          onClear={() => chain().unsetColor().run()}
        />
        <ColorPalette
          label="螢光筆"
          icon={<Highlighter size={ICON_SIZE} />}
          colors={HIGHLIGHT_COLORS}
          current={state.highlight}
          onPick={(color) => chain().setHighlight({ color }).run()}
          onClear={() => chain().unsetHighlight().run()}
        />
      </div>

      <div className="oc-tool-group">
        <ToolButton label="靠左" active={state.align === 'left'} onClick={() => setAlign('left')}>
          <TextAlignStart size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="置中"
          active={state.align === 'center'}
          onClick={() => setAlign('center')}
        >
          <TextAlignCenter size={ICON_SIZE} />
        </ToolButton>
        <ToolButton label="靠右" active={state.align === 'right'} onClick={() => setAlign('right')}>
          <TextAlignEnd size={ICON_SIZE} />
        </ToolButton>
      </div>

      <div className="oc-tool-group">
        <ToolButton
          label="項目清單"
          active={state.bulletList}
          onClick={() => chain().toggleBulletList().run()}
        >
          <List size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="編號清單"
          active={state.orderedList}
          onClick={() => chain().toggleOrderedList().run()}
        >
          <ListOrdered size={ICON_SIZE} />
        </ToolButton>
      </div>

      <NoteActions note={note} />
    </div>
  );
}
```

- [ ] **Step 7: 修改 `NotesApp`**

`packages/core/src/NotesApp.tsx` 完整內容（相對 M1 只有一處：`<Toolbar editor={editor} note={activeNote} />`）：

```tsx
import { EMPTY_DOC } from '@oc/shared';
import { Menu } from 'lucide-react';
import { useState } from 'react';
import { ActionBar } from './components/ActionBar';
import { Banner } from './components/Banner';
import { NoteList } from './components/NoteList';
import { Editor } from './editor/Editor';
import { TitleInput } from './editor/TitleInput';
import { Toolbar } from './editor/Toolbar';
import { useNoteEditor } from './editor/useNoteEditor';
import { displayTitle } from './notes/noteStore';
import { useNotes } from './notes/useNotes';
import { usePlatform } from './platform/PlatformContext';
import './styles/app.css';

export function NotesApp() {
  const { storage } = usePlatform();
  const {
    notes,
    activeNote,
    loading,
    createNote,
    selectNote,
    deleteNote,
    updateActive,
  } = useNotes(storage);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Called unconditionally (rules of hooks); recreated whenever the active note changes.
  const editor = useNoteEditor({
    noteId: activeNote?.id,
    content: activeNote?.content ?? EMPTY_DOC,
    onChange: (content) => updateActive({ content }),
  });

  if (loading || !activeNote) {
    return (
      <div className="oc-loading" role="status">
        載入中…
      </div>
    );
  }

  const closeDrawer = () => setDrawerOpen(false);

  const confirmDelete = (id: string) => {
    const target = notes.find((n) => n.id === id);
    if (!target) return;
    if (window.confirm(`確定要刪除「${displayTitle(target)}」嗎？此動作無法復原。`)) {
      void deleteNote(id);
    }
  };

  return (
    <div className="oc-app" data-drawer-open={drawerOpen ? 'true' : 'false'}>
      <aside className="oc-sidebar" id="oc-sidebar">
        <NoteList
          notes={notes}
          activeId={activeNote.id}
          onSelect={(id) => {
            selectNote(id);
            closeDrawer();
          }}
          onCreate={() => {
            void createNote();
            closeDrawer();
          }}
          onDelete={confirmDelete}
        />
      </aside>
      {drawerOpen && <div className="oc-backdrop" aria-hidden="true" onClick={closeDrawer} />}

      <main className="oc-main">
        <header className="oc-topbar">
          <button
            type="button"
            className="oc-menu-btn"
            aria-label={drawerOpen ? '關閉筆記清單' : '開啟筆記清單'}
            aria-controls="oc-sidebar"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((open) => !open)}
          >
            <Menu size={20} />
          </button>
          <ActionBar />
        </header>
        <Banner />
        <Toolbar editor={editor} note={activeNote} />
        <div className="oc-document">
          <TitleInput
            value={activeNote.title}
            onChange={(title) => updateActive({ title })}
            onEnter={() => editor.commands.focus('start')}
          />
          <Editor editor={editor} />
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 8: 加入樣式**

`packages/core/src/styles/app.css` 兩處修改。

(1) 把

```css
.oc-tool-group:last-child {
  border-right: none;
}
```

換成（清單群組後面緊接著複製／匯出時，不再畫分隔線）：

```css
.oc-tool-group:last-child,
.oc-tool-group:has(+ .oc-note-actions) {
  border-right: none;
}
```

(2) 在 `/* ---------- document ---------- */` 這行註解**之前**插入：

```css
/* ---------- copy / export (right end of the toolbar) ---------- */
.oc-note-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-left: auto;
}

.oc-action-status {
  color: var(--oc-muted);
  font-size: 13px;
  white-space: nowrap;
}

.oc-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--oc-border);
  border-radius: 999px;
  background: var(--oc-bg);
  color: var(--oc-text);
  font-size: 14px;
  white-space: nowrap;
  cursor: pointer;
}

.oc-action-btn:hover,
.oc-action-btn[aria-expanded='true'] {
  border-color: var(--oc-primary);
  color: var(--oc-primary);
}

.oc-export {
  position: relative;
}

.oc-export-menu {
  position: absolute;
  top: 36px;
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-width: 140px;
  padding: 6px;
  border: 1px solid var(--oc-border);
  border-radius: var(--oc-radius);
  background: var(--oc-bg);
  box-shadow: 0 8px 24px rgba(17, 24, 39, 0.12);
}

.oc-export-item {
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--oc-text);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.oc-export-item:hover,
.oc-export-item:focus {
  background: var(--oc-active-bg);
  color: var(--oc-primary);
  outline: none;
}
```

`margin-left: auto` 把複製／匯出推到工具列最右側；工具列換行時（< 768px）它們落在最後一列的右側。選單以 `right: 0` 對齊「匯出」鈕右緣向左展開，所以永遠不會超出畫面右側（Step 1 的窄螢幕 e2e 驗證）。`.oc-note-actions` 可換行、按鈕 `white-space: nowrap`：320px 寬時狀態訊息自成一列，按鈕文字不會被擠成直排。

- [ ] **Step 9: 執行元件測試與型別檢查，確認通過**

Run: `npm test -w @oc/core -- src/editor/Toolbar.test.tsx src/NotesApp.test.tsx && npm run typecheck -w @oc/core`
Expected: `Tests  18 passed (18)`；typecheck 無錯誤。

- [ ] **Step 10: 執行全部端對端測試，確認通過**

Run: `npm run e2e -w @oc/web`
Expected: `9 passed`（M1 的 4 個 + 本計畫的 5 個）。

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/editor/Toolbar.tsx packages/core/src/editor/Toolbar.test.tsx packages/core/src/NotesApp.tsx packages/core/src/NotesApp.test.tsx packages/core/src/styles/app.css apps/web/e2e/export.spec.ts
git commit -m "feat(core): add copy and export buttons to the toolbar"
```

---

### Task 13: Verification（整體驗證）

**Files:** 無新增或修改。

- [ ] **Step 1: 全部單元與元件測試**

Run: `npm test`
Expected:
- `@oc/core`：`Test Files  29 passed (29)`、`Tests  171 passed (171)`
- `@oc/shared`：`Test Files  1 passed (1)`、`Tests  3 passed (3)`
- `@oc/web`：`Test Files  1 passed (1)`、`Tests  1 passed (1)`

輸出中不應出現 `stderr`、`not wrapped in act(...)`、`Not implemented: window.print` 或 `Unhandled Errors`。

（若 M3a 已先執行，`npm test` 也會跑 `@oc/api`，其數字以 M3a 計畫為準；以上三個 workspace 的數字不變。）

- [ ] **Step 2: 全部型別檢查**

Run: `npm run typecheck`
Expected: 每個 workspace 的 `tsc --noEmit` 皆無錯誤輸出。

- [ ] **Step 3: 端對端測試（重複 3 次確認穩定）**

Run: `npm run e2e -w @oc/web -- --repeat-each=3`
Expected: `27 passed`

- [ ] **Step 4: 正式建置**

Run: `npm run build -w @oc/web`
Expected: `✓ built in`；`dist/assets/` 有 `index-*.js`（約 668 kB）、`toDocx-*.js`（約 365 kB）、`common-*.js`（約 1 kB）與 `index-*.css`；**沒有** `Some chunks are larger than 1000 kB` 警告。

- [ ] **Step 5: 手動檢查表**

Run: `npm run dev -w @oc/web`，用 Chrome 開 `http://localhost:5173`，建立一篇標題「週會紀錄」的筆記，內文包含：標題 1–3、粗體／斜體／底線、紅色字、黃色螢光、置中與靠右段落、兩層項目清單、編號清單、一段文字後再一個編號清單、Shift+Enter 換行。逐項確認：

- [ ] 工具列最右側有「複製」與「匯出 ▾」，與左側格式按鈕之間沒有多餘分隔線。
- [ ] 匯出 → Markdown：下載 `週會紀錄.md`；以 VS Code 預覽，標題為 `#`、內文標題降一級、粗斜底線正確、清單與編號正確；狀態列顯示「已匯出 Markdown」，約 3 秒後消失。
- [ ] 匯出 → Word：下載 `週會紀錄.docx`；以 Word 開啟，第一段為「標題」樣式，內文標題為「標題 1／2／3」，粗斜底線、紅字、黃色底色、置中／靠右皆保留；項目符號與編號正確，第二個編號清單重新從 1 開始。
- [ ] 匯出 → 純文字：下載 `週會紀錄.txt`；以記事本開啟，中文無亂碼，第一行標題、空一行、內文，清單保留 `- `／`1. `，沒有任何格式符號。
- [ ] 匯出 → PDF：出現瀏覽器列印對話框，預覽內容與筆記一致（含紅字與黃色螢光底色）；選「另存為 PDF」時預設檔名為「週會紀錄」；關閉對話框後，DevTools Console 執行 `document.querySelectorAll('iframe[data-oc-print]').length` 得到 `0`。
- [ ] 標題留白時匯出 Markdown，檔名為 `未命名筆記.md`；標題含 `/ : * ? " < > |` 時檔名自動去除這些字元。
- [ ] 複製 → 狀態列顯示「已複製全文」；貼到 Word 或 Google 文件保留標題與粗體等格式；貼到記事本為純文字（標題、空行、內文）。
- [ ] 鍵盤：Tab 到「匯出」按 Enter 開啟選單、焦點在「Markdown」；↑／↓ 循環移動；Enter 匯出；Esc 關閉選單且焦點回到「匯出」。
- [ ] DevTools 裝置模式寬度 390px 與 320px：複製／匯出在工具列最後一列右側，按鈕文字不換行；匯出選單完整顯示在畫面內。
- [ ] DevTools Network：第一次按「Word」時才載入 `toDocx-*.js`。
- [ ] DevTools Console 沒有錯誤或警告。

- [ ] **Step 6: 確認工作目錄乾淨**

Run: `git status --short -- . ':(exclude)docs/superpowers/plans'`
Expected: 沒有輸出（計畫檔因勾選 checkbox 而變動是允許的，故排除）。
