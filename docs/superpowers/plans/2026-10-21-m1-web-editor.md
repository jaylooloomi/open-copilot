# M1 Monorepo + 網頁編輯器 + 筆記清單 + 本機儲存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 npm workspaces monorepo，並完成可在瀏覽器使用的筆記應用：Tiptap 富文本編輯器、筆記清單（新增／切換／刪除，依更新時間排序）、IndexedDB 本機自動存檔，並附網頁靜態部署說明（spec §10）。

**Architecture:** `@oc/shared` 放前後端共用型別；`@oc/core` 放所有 React 元件與邏輯，平台能力（`NoteStorage`、`FileSaver`）一律經 `PlatformProvider` 注入，core 內不做任何平台判斷；`apps/web` 只負責 `selectPlatform()` 與掛載 `<NotesApp />`。`useNotes` 管理清單、作用中筆記與 500ms debounce 存檔；`useNoteEditor` 以 `noteId` 為 deps 建立 Tiptap editor，切換筆記時整個 editor 重建，因此內容與復原歷史不會跨筆記。

**Tech Stack:** TypeScript 5.9、React 19、Vite 7、Tiptap v3（StarterKit／TextStyle／Color／Highlight／TextAlign／Placeholder）、idb 8、lucide-react 1.x、Vitest 3 + jsdom 26 + Testing Library + fake-indexeddb、Playwright。

---

## 前置條件

- 在 repo 根目錄 `D:\git\open-copilot` 以 **Git Bash** 執行所有指令；repo 已 `git init` 且 spec 已 commit。
- Node 24、npm 11。
- 本計畫的程式碼已在本機以下列實際版本完整跑過（單元／元件測試、三個 workspace 的 typecheck、`vite build`、Playwright e2e）：typescript 5.9.3、react 19.3.1、vite 7.3.7、@vitejs/plugin-react 5.2.0、vitest 3.2.7、jsdom 26.1.0、@tiptap/* 3.32.0、idb 8.0.4、fake-indexeddb 6.2.6、lucide-react 1.60.0、@testing-library/react 16.3.3、@testing-library/jest-dom 6.10.0、@playwright/test 1.60–1.64。

- [ ] **前置步驟：commit 計畫文件（開始 Task 1 之前）**

目前只有 spec 已 commit，`docs/superpowers/plans/`（總覽、M1、M3a…）仍是未追蹤檔；之後每個 Task 的 `git add` 都只列程式碼路徑，不會順便加入它們。先 commit，Task 23 的「工作目錄乾淨」檢查才會成立。

Run: `git status --short`
Expected: 只有 `docs/superpowers/plans/` 底下的變動，通常是一行 `?? docs/superpowers/plans/`。若已沒有輸出，表示計畫已被 commit，略過本步其餘指令，直接進 Task 1；若出現其他路徑，先停下來回報。

```bash
git add docs/superpowers/plans
git commit -m "docs: add v1 implementation plans"
```

Run: `git status --short`
Expected: 沒有輸出（多了一個 commit）。

執行本計畫時勾選 `- [ ]` 會修改計畫檔本身，這是允許的；Task 23 的乾淨檢查會排除 `docs/superpowers/plans`。

## 與共用契約的關係（下游計畫必讀）

本計畫完全遵守 `2026-10-21-00-overview.md`。以下是契約沒有寫死、由本計畫決定的細節，M2／M3b／M4／M5 撰寫時請以此為準：

| 項目 | 決定 |
|---|---|
| Editor 實例從哪來 | `editor/useNoteEditor.ts` 的 `useNoteEditor({ noteId, content, onChange }): Editor`（Tiptap `Editor`）。`NotesApp` 呼叫它，並把同一個 editor 傳給 `<Toolbar editor>` 與 `<Editor editor>`。**M3b 的 `useRecorder({ editor, ... })` 應在 `NotesApp` 內使用這個 editor。** |
| `Editor.tsx` 介面 | `export function Editor({ editor }: { editor: TiptapEditor })`，只負責渲染 `EditorContent`。內文 DOM 帶 `role="textbox"`、`aria-label="筆記內文"`、class `oc-prose`。 |
| `Toolbar.tsx` 介面 | `export function Toolbar({ editor }: { editor: TiptapEditor })`；`role="toolbar"`、`aria-label="格式工具列"`；每顆按鈕的 `aria-label` 為 `復原`、`重做`、`粗體`、`斜體`、`底線`、`字色`、`螢光筆`、`靠左`、`置中`、`靠右`、`項目清單`、`編號清單`；段落樣式 `<select aria-label="段落樣式">`。M2 在最後一個 `.oc-tool-group` 之後加入複製／匯出。 |
| 調色盤 | `editor/palettes.ts`（`TEXT_COLORS`、`HIGHLIGHT_COLORS` 各 8 色）與 `editor/ColorPalette.tsx`（popover 元件）。 |
| `useNotes` | `useNotes(storage, options?: { now?: () => number; saveDelayMs?: number })`；回傳 `createNote(): Promise<Note>`、`selectNote(id): void`、`deleteNote(id): Promise<void>`、`updateActive(patch: NotePatch): void`。另外在 `pagehide` 與 `visibilitychange`（hidden）時 flush。 |
| `noteStore.ts` 額外匯出 | `sortByUpdatedDesc(notes)`、`displayTitle(note)`、`UNTITLED_NOTE = '未命名筆記'`。 |
| IndexedDB 寫入 | `createIndexedDbStorage().put` 用明確的 `tx.commit()`，讓 `pagehide` 中的存檔不被中止。M3b 的 `pendingQueue.add` 若也可能在頁面關閉時寫入，建議比照。 |
| `db.ts` 的 pendingSegments 值型別 | `PendingSegmentRecord`（欄位與契約的 `PendingSegment` 完全相同）。M3b 的 `pendingQueue.ts` 可直接 `export type PendingSegment = PendingSegmentRecord`。 |
| `NoteList` props | `{ notes, activeId, onSelect(id), onCreate(), onDelete(id) }`；清單 `<ul aria-label="筆記清單">`；刪除鈕 `aria-label="刪除「{標題}」"`。刪除前由 `NotesApp` 以 `window.confirm('確定要刪除「{標題}」嗎？此動作無法復原。')` 確認。M3b 若要錄音中停用，請在此加 `disabled?: boolean`。 |
| `ActionBar` | M1 無 props。M3b 改為接收錄音狀態。 |
| M3b 取得 `db` | 契約的 `useRecorder({ editor, noteId, settings, db })` 與 `createPendingQueue(db)` 需要 `IDBPDatabase<AppDbSchema>`，但 `Platform` 介面（`{ storage, fileSaver, canPrint }`）是固定契約，**維持不變**。M3b 在 `NotesApp` 內以 `const dbPromise = useMemo(() => openAppDb(), [])` 開啟同名 `'open-copilot'` 的第二個連線（IndexedDB 允許同一頁面多個連線；三端皆為 IndexedDB，不違反「core 無平台判斷」），await 後再把 `db` 傳給 `useRecorder` 與 `createPendingQueue`。若 M3b 認為應把 `db` 放進 `Platform`，必須先回報契約變更，不得自行擴充介面。 |
| 抽屜選單鈕 | 在 `NotesApp` 的 `.oc-topbar` 內，`aria-label` 在 `開啟筆記清單`／`關閉筆記清單` 之間切換；寬度 < 768px 才顯示。 |
| 測試輔助 | `packages/core/src/test/memoryStorage.ts`：`createMemoryStorage(initial?)`、`createTestPlatform(initial?)`（方法皆為 `vi.fn`）。 |
| jsdom 補強 | `packages/core/src/test/setup.ts` 給 `Range.prototype.getClientRects/getBoundingClientRect` 空矩形；沒有它，`editor.chain().focus()` 會丟 `target.getClientRects is not a function`。 |
| 網頁部署說明 | `apps/web/README.md`（Task 22）：建置指令、產物目錄 `apps/web/dist`、Vercel／Cloudflare Pages 設定、部署限制（網域根目錄、HTTPS、ES2022）、把正式網域加進 M3a 的 `ALLOWED_ORIGINS`。下游計畫若改變建置產物或部署限制（例如加入前端路由、改 Vite `base`、改 `ALLOWED_ORIGINS` 預設值），必須同步更新這份文件。 |

額外的**開發**依賴（不是執行期套件）：根目錄 `@types/node`（Vitest 的型別引用 node 型別，缺了 `tsc --noEmit` 會報 `TS2688: Cannot find type definition file for 'node'`）、`@testing-library/dom`（`@testing-library/react@16` 的 peer dependency）、`packages/core` 的 `@vitejs/plugin-react`（給 Vitest 轉譯 JSX）。

lucide-react 1.x 的對齊圖示正式名稱是 `TextAlignStart`／`TextAlignCenter`／`TextAlignEnd`，垃圾桶是 `Trash`；本計畫使用這些名稱。

## File Structure

| 檔案 | 職責 |
|---|---|
| `package.json` | 根：private、workspaces、跨 workspace 的 `test`／`typecheck`／`e2e` scripts、共用開發工具 |
| `tsconfig.base.json` | 所有套件共用的 strict TS 設定（bundler resolution、react-jsx、ES2022） |
| `.gitignore` | 忽略 node_modules、dist、coverage、Playwright 輸出、.env、Android build |
| `packages/shared/package.json`、`tsconfig.json` | `@oc/shared` 套件設定（以原始碼匯出） |
| `packages/shared/src/note.ts` | `JSONContent`、`Note`、`EMPTY_DOC` |
| `packages/shared/src/api.ts` | API 常數與請求／回應型別（M3a／M3b 使用） |
| `packages/shared/src/index.ts` | 重新匯出 |
| `packages/shared/src/index.test.ts` | 型別與常數的冒煙測試 |
| `packages/core/package.json`、`tsconfig.json`、`vitest.config.ts` | `@oc/core` 套件、型別檢查、jsdom 測試設定 |
| `packages/core/src/test/setup.ts` | jest-dom matchers、fake-indexeddb、RTL cleanup、jsdom Range 補強 |
| `packages/core/src/test/memoryStorage.ts` | 測試用記憶體 `NoteStorage` 與 `Platform` |
| `packages/core/src/platform/types.ts` | `NoteStorage`、`FileSaver`、`Platform` 介面 |
| `packages/core/src/platform/db.ts` | `openAppDb()`：IndexedDB schema（`notes`、`pendingSegments`） |
| `packages/core/src/platform/indexedDbStorage.ts` | 以 IndexedDB 實作 `NoteStorage` |
| `packages/core/src/platform/browserFileSaver.ts` | 以 `<a download>` 實作 `FileSaver` |
| `packages/core/src/platform/PlatformContext.tsx` | `PlatformProvider`、`usePlatform()` |
| `packages/core/src/notes/noteStore.ts` | `createNote`、`sortByUpdatedDesc`、`displayTitle` |
| `packages/core/src/notes/debounce.ts` | 帶 `flush()`／`cancel()` 的 debounce |
| `packages/core/src/notes/useNotes.ts` | 筆記清單狀態、作用中筆記、debounce 自動存檔 |
| `packages/core/src/editor/extensions.ts` | `createExtensions()`：Tiptap 擴充組合與 placeholder |
| `packages/core/src/editor/useNoteEditor.ts` | 依 `noteId` 建立／重建 Tiptap editor，回報 JSON 變更 |
| `packages/core/src/editor/Editor.tsx` | 渲染 editor 內文 |
| `packages/core/src/editor/palettes.ts` | 字色與螢光筆 8 色調色盤資料 |
| `packages/core/src/editor/ColorPalette.tsx` | 調色盤 popover（8 色 + 清除） |
| `packages/core/src/editor/Toolbar.tsx` | 格式工具列 |
| `packages/core/src/editor/TitleInput.tsx` | 標題輸入框 |
| `packages/core/src/components/NoteList.tsx` | 左側筆記清單 |
| `packages/core/src/components/ActionBar.tsx` | 「錄製」鈕（M1 停用）+ 4 顆上鎖 AI 鈕 |
| `packages/core/src/components/Banner.tsx` | 錄音提示橫幅 |
| `packages/core/src/NotesApp.tsx` | 組裝整個畫面、抽屜開關、刪除確認 |
| `packages/core/src/styles/app.css` | 全部樣式（CSS 變數、主色漸層、< 768px 抽屜） |
| `packages/core/src/index.ts` | `@oc/core` 公開 API |
| `apps/web/package.json`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts` | `@oc/web` 設定 |
| `apps/web/index.html` | HTML 入口 |
| `apps/web/src/main.tsx` | 選平台並掛載 React |
| `apps/web/src/platform/selectPlatform.ts` | M1：回傳網頁平台 |
| `apps/web/src/test/setup.ts` | web 單元測試的 fake-indexeddb |
| `apps/web/playwright.config.ts`、`apps/web/e2e/notes.spec.ts` | 端對端測試 |
| `apps/web/README.md` | 網頁建置、靜態部署（Vercel／Cloudflare Pages）與後端 `ALLOWED_ORIGINS` 設定說明 |

每個 `*.ts(x)` 旁邊的 `*.test.ts(x)` 為其測試。

---

### Task 1: Monorepo 根目錄骨架

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

- [ ] **Step 1: 建立根 `package.json`**

`package.json`：

```json
{
  "name": "open-copilot",
  "version": "0.0.0",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "e2e": "npm run e2e -w @oc/web"
  },
  "devDependencies": {
    "@types/node": "^24.19.2",
    "typescript": "^5.9.3",
    "vitest": "^3.2.7"
  }
}
```

`workspaces` 刻意寫成單行：M3a 的前置檢查以 `grep -n "workspaces" package.json` 比對 `"workspaces": ["packages/*", "apps/*"]`。本計畫之後只執行不帶參數的 `npm install`，不會改寫根 `package.json`。

- [ ] **Step 2: 建立 `tsconfig.base.json`**

`tsconfig.base.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

- [ ] **Step 3: 建立 `.gitignore`**

`.gitignore`：

```gitignore
node_modules/
dist/
coverage/
playwright-report/
test-results/
.env
apps/web/android/app/build/
```

- [ ] **Step 4: 安裝並確認工具可用**

Run: `npm install && npx tsc --version && npx vitest --version && grep -n '"workspaces"' package.json`
Expected: 產生 `package-lock.json`；輸出 `Version 5.9.x` 與 `vitest/3.2.x ...`；最後一行是 `5:  "workspaces": ["packages/*", "apps/*"],`（grep 的樣式含雙引號，所以不會比對到 scripts 裡的 `--workspaces`）。（此時還沒有任何 workspace，npm 不會報錯。）

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json .gitignore
git commit -m "chore: scaffold npm workspaces monorepo"
```

---

### Task 2: `@oc/shared` 共用型別

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/note.ts`
- Create: `packages/shared/src/api.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/index.test.ts`

- [ ] **Step 1: 建立套件設定**

`packages/shared/package.json`：

```json
{
  "name": "@oc/shared",
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
  }
}
```

`packages/shared/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

Run: `npm install`
Expected: 成功，`node_modules/@oc/shared` 為指向 `packages/shared` 的連結。

- [ ] **Step 2: 寫失敗的測試**

`packages/shared/src/index.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  EMPTY_DOC,
  MAX_AUDIO_BYTES,
  RATE_LIMIT_PER_MINUTE,
  type ApiErrorBody,
  type Note,
  type TranscribeResponse,
} from './index';

describe('@oc/shared', () => {
  it('EMPTY_DOC is a Tiptap doc with one empty paragraph', () => {
    expect(EMPTY_DOC).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('exposes the API limits used by the backend and the recorder', () => {
    expect(MAX_AUDIO_BYTES).toBe(5 * 1024 * 1024);
    expect(RATE_LIMIT_PER_MINUTE).toBe(60);
  });

  it('types describe notes and API payloads', () => {
    const note: Note = { id: 'n1', title: '', content: EMPTY_DOC, createdAt: 1, updatedAt: 2 };
    const res: TranscribeResponse = { seq: 1, text: '你好' };
    const err: ApiErrorBody = { error: 'rate_limited' };
    expect([note.id, res.seq, err.error]).toEqual(['n1', 1, 'rate_limited']);
  });
});
```

- [ ] **Step 3: 執行測試，確認失敗**

Run: `npm test -w @oc/shared`
Expected: FAIL，`Error: Failed to resolve import "./index" from "src/index.test.ts". Does the file exist?`

- [ ] **Step 4: 實作**

`packages/shared/src/note.ts`：

```ts
export interface JSONContent {
  type?: string;
  attrs?: Record<string, any>;
  content?: JSONContent[];
  marks?: { type: string; attrs?: Record<string, any>; [key: string]: any }[];
  text?: string;
  [key: string]: any;
}

export interface Note {
  id: string;
  title: string;
  content: JSONContent;
  createdAt: number;
  updatedAt: number;
}

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
```

`packages/shared/src/api.ts`：

```ts
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
export const RATE_LIMIT_PER_MINUTE = 60;

export interface TranscribeResponse {
  seq: number;
  text: string;
}

export interface HealthResponse {
  ok: true;
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'payload_too_large'
  | 'rate_limited'
  | 'bad_request'
  | 'upstream_error';

export interface ApiErrorBody {
  error: ApiErrorCode;
}
```

`packages/shared/src/index.ts`：

```ts
export * from './note';
export * from './api';
```

- [ ] **Step 5: 執行測試與型別檢查，確認通過**

Run: `npm test -w @oc/shared && npm run typecheck -w @oc/shared`
Expected: `Tests  3 passed (3)`；`tsc --noEmit` 無輸出。

- [ ] **Step 6: Commit**

```bash
git add packages/shared package-lock.json
git commit -m "feat(shared): add Note and API contract types"
```

---

### Task 3: `@oc/core` 骨架、測試環境與平台介面

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/test/setup.ts`
- Create: `packages/core/src/platform/types.ts`
- Test: `packages/core/src/test/setup.test.ts`

- [ ] **Step 1: 建立套件設定並安裝依賴**

一次列出 M1 需要的全部依賴，之後的 Task 不再改 `package.json`。

`packages/core/package.json`：

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
    "jsdom": "^26.1.0"
  }
}
```

`packages/core/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/core/vitest.config.ts`：

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

Run: `npm install`
Expected: 成功安裝 Tiptap、React、idb、Testing Library 等套件。

- [ ] **Step 2: 寫失敗的測試**

`packages/core/src/test/setup.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

describe('test setup', () => {
  it('provides jest-dom matchers', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(el).toBeInTheDocument();
  });

  it('provides a fake indexedDB', () => {
    expect(typeof indexedDB.open).toBe('function');
  });

  it('gives DOM ranges empty layout rects for ProseMirror', () => {
    const range = document.createRange();
    expect(range.getClientRects()).toHaveLength(0);
    expect(range.getBoundingClientRect().width).toBe(0);
  });
});
```

- [ ] **Step 3: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/test/setup.test.ts`
Expected: FAIL，`Error: Cannot find module '.../packages/core/src/test/setup.ts'`（setup 檔還不存在）。

- [ ] **Step 4: 建立 setup 檔**

`packages/core/src/test/setup.ts`：

```ts
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom has no layout engine. ProseMirror measures DOM ranges when it scrolls the
// selection into view (e.g. after editor.chain().focus()), so give ranges empty rects.
const emptyRect = (): DOMRect => DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
Range.prototype.getBoundingClientRect = emptyRect;
Range.prototype.getClientRects = () => {
  const rects: DOMRect[] = [];
  return Object.assign(rects, { item: () => null }) as unknown as DOMRectList;
};
```

說明：Vitest 未開 `globals`，Testing Library 不會自動 cleanup，所以在 `afterEach` 手動呼叫。Range 補強是 ProseMirror 在 jsdom 中捲動選取範圍所需（Task 14 的工具列測試沒有它會失敗）。

- [ ] **Step 5: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/test/setup.test.ts`
Expected: `Tests  3 passed (3)`

- [ ] **Step 6: 建立平台介面並做型別檢查**

`packages/core/src/platform/types.ts`：

```ts
import type { Note } from '@oc/shared';

export interface NoteStorage {
  /** All notes, newest `updatedAt` first. */
  list(): Promise<Note[]>;
  get(id: string): Promise<Note | undefined>;
  put(note: Note): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface FileSaver {
  save(filename: string, data: Blob): Promise<void>;
}

export interface Platform {
  storage: NoteStorage;
  fileSaver: FileSaver;
  /** false hides "匯出 PDF" (Android WebView has no window.print). */
  canPrint: boolean;
}
```

Run: `npm run typecheck -w @oc/core`
Expected: 無錯誤輸出。

- [ ] **Step 7: Commit**

```bash
git add packages/core package-lock.json
git commit -m "chore(core): scaffold core package with vitest jsdom setup and platform types"
```

---

### Task 4: `noteStore`：建立、排序、顯示標題

**Files:**
- Create: `packages/core/src/notes/noteStore.ts`
- Test: `packages/core/src/notes/noteStore.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/notes/noteStore.test.ts`：

```ts
import { EMPTY_DOC, type Note } from '@oc/shared';
import { describe, expect, it } from 'vitest';
import { createNote, displayTitle, sortByUpdatedDesc } from './noteStore';

const note = (id: string, updatedAt: number, createdAt = 0): Note => ({
  id,
  title: id,
  content: EMPTY_DOC,
  createdAt,
  updatedAt,
});

describe('createNote', () => {
  it('creates an empty untitled note stamped with the given time', () => {
    const n = createNote(1_700_000_000_000);
    expect(n).toEqual({
      id: expect.any(String),
      title: '',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
  });

  it('gives every note a unique id and its own content object', () => {
    const a = createNote(1);
    const b = createNote(1);
    expect(a.id).not.toBe(b.id);
    expect(a.content).not.toBe(EMPTY_DOC);
  });
});

describe('sortByUpdatedDesc', () => {
  it('orders newest first without mutating the input', () => {
    const input = [note('a', 1), note('b', 3), note('c', 2)];
    expect(sortByUpdatedDesc(input).map((n) => n.id)).toEqual(['b', 'c', 'a']);
    expect(input.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks updatedAt ties by createdAt, newest first', () => {
    const input = [note('old', 5, 1), note('new', 5, 2)];
    expect(sortByUpdatedDesc(input).map((n) => n.id)).toEqual(['new', 'old']);
  });
});

describe('displayTitle', () => {
  it('returns the trimmed title', () => {
    expect(displayTitle({ title: '  週會紀錄 ' })).toBe('週會紀錄');
  });

  it('falls back to 未命名筆記 for blank titles', () => {
    expect(displayTitle({ title: '' })).toBe('未命名筆記');
    expect(displayTitle({ title: '   ' })).toBe('未命名筆記');
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/notes/noteStore.test.ts`
Expected: FAIL，`Failed to resolve import "./noteStore" from "src/notes/noteStore.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/notes/noteStore.ts`：

```ts
import { EMPTY_DOC, type Note } from '@oc/shared';

export const UNTITLED_NOTE = '未命名筆記';

export function createNote(now: number = Date.now()): Note {
  return {
    id: crypto.randomUUID(),
    title: '',
    content: structuredClone(EMPTY_DOC),
    createdAt: now,
    updatedAt: now,
  };
}

export function sortByUpdatedDesc(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}

/** Title shown in the note list; blank titles become 未命名筆記. */
export function displayTitle(note: Pick<Note, 'title'>): string {
  return note.title.trim() || UNTITLED_NOTE;
}
```

`structuredClone` 讓每篇新筆記都有自己的 content 物件，避免共用 `EMPTY_DOC` 被意外修改。

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/notes/noteStore.test.ts`
Expected: `Tests  6 passed (6)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/notes/noteStore.ts packages/core/src/notes/noteStore.test.ts
git commit -m "feat(core): add note factory, sorting and display title helpers"
```

---

### Task 5: IndexedDB schema（`openAppDb`）

**Files:**
- Create: `packages/core/src/platform/db.ts`
- Test: `packages/core/src/platform/db.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/platform/db.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { openAppDb } from './db';

describe('openAppDb', () => {
  it('creates the notes and pendingSegments stores at version 1', async () => {
    const db = await openAppDb(`test-${crypto.randomUUID()}`);
    expect(db.version).toBe(1);
    expect([...db.objectStoreNames].sort()).toEqual(['notes', 'pendingSegments']);
    expect(db.transaction('notes').store.keyPath).toBe('id');
    expect(db.transaction('pendingSegments').store.keyPath).toBe('gapId');
    db.close();
  });

  it('reopens an existing database without losing data', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const first = await openAppDb(name);
    await first.put('notes', {
      id: 'n1',
      title: 'kept',
      content: { type: 'doc' },
      createdAt: 1,
      updatedAt: 1,
    });
    first.close();

    const second = await openAppDb(name);
    expect((await second.get('notes', 'n1'))?.title).toBe('kept');
    second.close();
  });
});
```

每個測試用隨機 DB 名稱，避免 fake-indexeddb 的狀態互相影響。

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/platform/db.test.ts`
Expected: FAIL，`Failed to resolve import "./db" from "src/platform/db.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/platform/db.ts`：

```ts
import type { Note } from '@oc/shared';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/** Audio segment waiting for a manual retry (used from M3b). */
export interface PendingSegmentRecord {
  gapId: string;
  noteId: string;
  seq: number;
  blob: Blob;
  mimeType: string;
  prompt: string;
}

export interface AppDbSchema extends DBSchema {
  notes: { key: string; value: Note };
  pendingSegments: { key: string; value: PendingSegmentRecord };
}

export const APP_DB_VERSION = 1;

export function openAppDb(name = 'open-copilot'): Promise<IDBPDatabase<AppDbSchema>> {
  return openDB<AppDbSchema>(name, APP_DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('notes', { keyPath: 'id' });
      db.createObjectStore('pendingSegments', { keyPath: 'gapId' });
    },
  });
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/platform/db.test.ts`
Expected: `Tests  2 passed (2)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/platform/db.ts packages/core/src/platform/db.test.ts
git commit -m "feat(core): add IndexedDB schema with notes and pendingSegments stores"
```

---

### Task 6: `createIndexedDbStorage`

**Files:**
- Create: `packages/core/src/platform/indexedDbStorage.ts`
- Test: `packages/core/src/platform/indexedDbStorage.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/platform/indexedDbStorage.test.ts`：

```ts
import { EMPTY_DOC, type Note } from '@oc/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { openAppDb } from './db';
import { createIndexedDbStorage } from './indexedDbStorage';
import type { NoteStorage } from './types';

const note = (id: string, updatedAt: number, title = id): Note => ({
  id,
  title,
  content: EMPTY_DOC,
  createdAt: 0,
  updatedAt,
});

describe('createIndexedDbStorage', () => {
  let storage: NoteStorage;

  beforeEach(async () => {
    storage = createIndexedDbStorage(await openAppDb(`test-${crypto.randomUUID()}`));
  });

  it('starts empty', async () => {
    expect(await storage.list()).toEqual([]);
    expect(await storage.get('missing')).toBeUndefined();
  });

  it('puts and gets a note', async () => {
    await storage.put(note('a', 1, '第一篇'));
    expect(await storage.get('a')).toEqual(note('a', 1, '第一篇'));
  });

  it('overwrites a note with the same id', async () => {
    await storage.put(note('a', 1, 'old'));
    await storage.put(note('a', 2, 'new'));
    expect(await storage.list()).toEqual([note('a', 2, 'new')]);
  });

  it('lists notes newest updatedAt first', async () => {
    await storage.put(note('a', 1));
    await storage.put(note('b', 3));
    await storage.put(note('c', 2));
    expect((await storage.list()).map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('removes a note', async () => {
    await storage.put(note('a', 1));
    await storage.put(note('b', 2));
    await storage.remove('a');
    expect((await storage.list()).map((n) => n.id)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/platform/indexedDbStorage.test.ts`
Expected: FAIL，`Failed to resolve import "./indexedDbStorage" from "src/platform/indexedDbStorage.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/platform/indexedDbStorage.ts`：

```ts
import type { IDBPDatabase } from 'idb';
import { sortByUpdatedDesc } from '../notes/noteStore';
import type { AppDbSchema } from './db';
import type { NoteStorage } from './types';

export function createIndexedDbStorage(db: IDBPDatabase<AppDbSchema>): NoteStorage {
  return {
    async list() {
      return sortByUpdatedDesc(await db.getAll('notes'));
    },
    get(id) {
      return db.get('notes', id);
    },
    async put(note) {
      const tx = db.transaction('notes', 'readwrite');
      const request = tx.store.put(note);
      // Commit explicitly: a save flushed from a `pagehide` handler (reload / closing the tab)
      // is otherwise aborted by Chrome before the auto-commit happens.
      tx.commit();
      // Await the request too, so a failed write (quota, abort, uncloneable value) rejects
      // exactly once here instead of also surfacing as an unhandled rejection.
      await Promise.all([request, tx.done]);
    },
    async remove(id) {
      await db.delete('notes', id);
    },
  };
}
```

`put` 明確呼叫 `tx.commit()`：已實測，若只用 `db.put()`，在 `pagehide`（重新整理、關分頁）中送出的最後一次存檔會被 Chrome 中止而遺失；加上明確 commit 後，Task 21 的「立刻重新整理」e2e 連續 30 次皆通過。fake-indexeddb 也支援 `commit()`，單元測試不受影響。`put` 請求的 promise 不可丟棄（`void`）：寫入失敗時 idb 會讓它 reject，沒人接就會在 Console 多出一筆 `Uncaught (in promise)`，與 `useNotes` 已經接住並記錄的 `tx.done` 錯誤重複；用 `Promise.all([request, tx.done])` 同時等待兩者，失敗只回報一次。

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/platform/indexedDbStorage.test.ts`
Expected: `Tests  5 passed (5)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/platform/indexedDbStorage.ts packages/core/src/platform/indexedDbStorage.test.ts
git commit -m "feat(core): implement NoteStorage on IndexedDB"
```

---

### Task 7: `createBrowserFileSaver`

**Files:**
- Create: `packages/core/src/platform/browserFileSaver.ts`
- Test: `packages/core/src/platform/browserFileSaver.test.ts`

- [ ] **Step 1: 寫失敗的測試**

jsdom 沒有 `URL.createObjectURL`／`revokeObjectURL`，測試直接裝上假的；並攔截 `<a>.click()`，避免 jsdom 嘗試導覽。

`packages/core/src/platform/browserFileSaver.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserFileSaver } from './browserFileSaver';

describe('createBrowserFileSaver', () => {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:fake-url');
  const revokeObjectURL = vi.fn((_url: string) => undefined);
  let clicked: { href: string; download: string; attached: boolean }[];

  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no object URLs; install fakes.
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download, attached: this.isConnected });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  it('downloads the blob through a temporary <a download> link', async () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });
    await createBrowserFileSaver().save('筆記.txt', blob);

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([{ href: 'blob:fake-url', download: '筆記.txt', attached: true }]);
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('revokes the object URL after the download has started', async () => {
    await createBrowserFileSaver().save('a.md', new Blob(['# a']));
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/platform/browserFileSaver.test.ts`
Expected: FAIL，`Failed to resolve import "./browserFileSaver" from "src/platform/browserFileSaver.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/platform/browserFileSaver.ts`：

```ts
import type { FileSaver } from './types';

const REVOKE_DELAY_MS = 1000;

export function createBrowserFileSaver(): FileSaver {
  return {
    async save(filename, data) {
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Some browsers read the URL asynchronously after click(); revoke later.
      setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
    },
  };
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/platform/browserFileSaver.test.ts`
Expected: `Tests  2 passed (2)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/platform/browserFileSaver.ts packages/core/src/platform/browserFileSaver.test.ts
git commit -m "feat(core): add browser download FileSaver"
```

---

### Task 8: `PlatformProvider`／`usePlatform` 與測試輔助

**Files:**
- Create: `packages/core/src/test/memoryStorage.ts`
- Create: `packages/core/src/platform/PlatformContext.tsx`
- Test: `packages/core/src/platform/PlatformContext.test.tsx`

- [ ] **Step 1: 建立測試輔助（後續 Task 共用）**

`packages/core/src/test/memoryStorage.ts`：

```ts
import type { Note } from '@oc/shared';
import { vi } from 'vitest';
import { sortByUpdatedDesc } from '../notes/noteStore';
import type { NoteStorage } from '../platform/types';

/** In-memory NoteStorage whose methods are vi.fn spies, for hook and component tests. */
export function createMemoryStorage(initial: Note[] = []) {
  const notes = new Map(initial.map((n) => [n.id, structuredClone(n)]));
  const storage = {
    list: vi.fn(async () => sortByUpdatedDesc([...notes.values()].map((n) => structuredClone(n)))),
    get: vi.fn(async (id: string) => {
      const n = notes.get(id);
      return n && structuredClone(n);
    }),
    put: vi.fn(async (note: Note) => {
      notes.set(note.id, structuredClone(note));
    }),
    remove: vi.fn(async (id: string) => {
      notes.delete(id);
    }),
  } satisfies NoteStorage;
  return { storage, notes };
}

/** A minimal platform for rendering components in tests. */
export function createTestPlatform(initial: Note[] = []) {
  const { storage, notes } = createMemoryStorage(initial);
  const fileSaver = { save: vi.fn(async (_filename: string, _data: Blob) => undefined) };
  return { platform: { storage, fileSaver, canPrint: true }, storage, notes, fileSaver };
}
```

- [ ] **Step 2: 寫失敗的測試**

`packages/core/src/platform/PlatformContext.test.tsx`：

```tsx
import { render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createTestPlatform } from '../test/memoryStorage';
import { PlatformProvider, usePlatform } from './PlatformContext';

function ShowCanPrint() {
  const platform = usePlatform();
  return <p>{platform.canPrint ? 'can print' : 'no print'}</p>;
}

describe('PlatformContext', () => {
  it('provides the platform to descendants', () => {
    const { platform } = createTestPlatform();
    render(
      <PlatformProvider platform={{ ...platform, canPrint: false }}>
        <ShowCanPrint />
      </PlatformProvider>,
    );
    expect(screen.getByText('no print')).toBeInTheDocument();
  });

  it('throws a clear error outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => usePlatform())).toThrow(
      'usePlatform must be used inside <PlatformProvider>',
    );
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 3: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/platform/PlatformContext.test.tsx`
Expected: FAIL，`Failed to resolve import "./PlatformContext" from "src/platform/PlatformContext.test.tsx". Does the file exist?`

- [ ] **Step 4: 實作**

`packages/core/src/platform/PlatformContext.tsx`：

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import type { Platform } from './types';

const PlatformContext = createContext<Platform | null>(null);

export function PlatformProvider({
  platform,
  children,
}: {
  platform: Platform;
  children: ReactNode;
}) {
  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): Platform {
  const platform = useContext(PlatformContext);
  if (!platform) {
    throw new Error('usePlatform must be used inside <PlatformProvider>');
  }
  return platform;
}
```

- [ ] **Step 5: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/platform/PlatformContext.test.tsx`
Expected: `Tests  2 passed (2)`

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/test/memoryStorage.ts packages/core/src/platform/PlatformContext.tsx packages/core/src/platform/PlatformContext.test.tsx
git commit -m "feat(core): add PlatformProvider and in-memory test platform"
```

---

### Task 9: `debounce`（含 `flush`／`cancel`）

**Files:**
- Create: `packages/core/src/notes/debounce.ts`
- Test: `packages/core/src/notes/debounce.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/notes/debounce.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce } from './debounce';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls fn once, ms after the last call, with the last arguments', () => {
    const fn = vi.fn();
    const d = debounce(fn, 500);
    d('a');
    vi.advanceTimersByTime(300);
    d('b');
    vi.advanceTimersByTime(499);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('b');
  });

  it('flush() runs a pending call immediately and only once', () => {
    const fn = vi.fn();
    const d = debounce(fn, 500);
    d(1);
    d.flush();
    expect(fn).toHaveBeenCalledWith(1);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flush() does nothing when no call is pending', () => {
    const fn = vi.fn();
    const d = debounce(fn, 500);
    d.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel() drops a pending call', () => {
    const fn = vi.fn();
    const d = debounce(fn, 500);
    d(1);
    d.cancel();
    vi.advanceTimersByTime(1000);
    d.flush();
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/notes/debounce.test.ts`
Expected: FAIL，`Failed to resolve import "./debounce" from "src/notes/debounce.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/notes/debounce.ts`：

```ts
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** Run the pending call now (no-op when nothing is pending). */
  flush(): void;
  /** Drop the pending call. */
  cancel(): void;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: A | undefined;

  const run = () => {
    const args = lastArgs as A;
    timer = undefined;
    lastArgs = undefined;
    fn(...args);
  };

  const debounced = ((...args: A) => {
    lastArgs = args;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(run, ms);
  }) as Debounced<A>;

  debounced.flush = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    run();
  };

  debounced.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    lastArgs = undefined;
  };

  return debounced;
}
```

`setTimeout` 在每次呼叫時才讀全域，因此測試中途才 `vi.useFakeTimers()` 也有效（Task 10 依賴這點）。

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/notes/debounce.test.ts`
Expected: `Tests  4 passed (4)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/notes/debounce.ts packages/core/src/notes/debounce.test.ts
git commit -m "feat(core): add debounce with flush and cancel"
```

---

### Task 10: `useNotes`：清單、切換、刪除、自動存檔

**Files:**
- Create: `packages/core/src/notes/useNotes.ts`
- Test: `packages/core/src/notes/useNotes.test.ts`

- [ ] **Step 1: 寫失敗的測試**

測試先用真實計時器等初次載入（Testing Library 的 `waitFor` 在 Vitest 假計時器下會卡住），載入完成後才切換為假計時器；時間用可手動推進的 `now`。

`packages/core/src/notes/useNotes.test.ts`：

```ts
import { EMPTY_DOC, type Note } from '@oc/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../test/memoryStorage';
import { useNotes } from './useNotes';

const note = (id: string, updatedAt: number, title = id): Note => ({
  id,
  title,
  content: EMPTY_DOC,
  createdAt: updatedAt,
  updatedAt,
});

/** Renders useNotes with a manual clock, waits for the initial load, then fakes timers. */
async function setup(initial: Note[] = []) {
  const { storage } = createMemoryStorage(initial);
  let clock = 10_000;
  const now = () => clock;
  const tick = (ms = 1) => {
    clock += ms;
  };
  const hook = renderHook(() => useNotes(storage, { now }));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  vi.useFakeTimers();
  storage.put.mockClear();
  storage.remove.mockClear();
  return { storage, tick, ...hook };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useNotes', () => {
  it('creates and persists a first note when storage is empty', async () => {
    const { storage } = createMemoryStorage();
    const { result } = renderHook(() => useNotes(storage, { now: () => 5 }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.notes).toHaveLength(1);
    expect(result.current.activeNote).toMatchObject({ title: '', createdAt: 5, updatedAt: 5 });
    expect(storage.put).toHaveBeenCalledWith(result.current.activeNote);
  });

  it('loads existing notes newest first and activates the newest', async () => {
    const { result } = await setup([note('a', 1), note('b', 2)]);
    expect(result.current.notes.map((n) => n.id)).toEqual(['b', 'a']);
    expect(result.current.activeNote?.id).toBe('b');
  });

  it('updateActive changes memory at once and saves after 500ms without edits', async () => {
    const { result, storage, tick } = await setup([note('a', 1)]);
    tick(100);
    act(() => result.current.updateActive({ title: '會議紀錄' }));

    expect(result.current.activeNote).toMatchObject({ title: '會議紀錄', updatedAt: 10_100 });
    act(() => vi.advanceTimersByTime(499));
    expect(storage.put).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', title: '會議紀錄' }));
  });

  it('coalesces rapid edits into one write with the latest title and content', async () => {
    const { result, storage } = await setup([note('a', 1)]);
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '內文' }] }] };
    act(() => result.current.updateActive({ title: 'x' }));
    act(() => result.current.updateActive({ title: 'xy' }));
    act(() => result.current.updateActive({ content }));
    act(() => vi.advanceTimersByTime(500));

    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ title: 'xy', content }));
  });

  it('moves the edited note to the top of the list', async () => {
    const { result, tick } = await setup([note('a', 1), note('b', 2)]);
    act(() => result.current.selectNote('a'));
    tick();
    act(() => result.current.updateActive({ title: 'A2' }));
    expect(result.current.notes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('selectNote flushes the pending save of the previous note', async () => {
    const { result, storage } = await setup([note('a', 1), note('b', 2)]);
    act(() => result.current.updateActive({ title: 'B2' }));
    act(() => result.current.selectNote('a'));

    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', title: 'B2' }));
    expect(result.current.activeNote?.id).toBe('a');
  });

  it('createNote flushes pending edits, persists a new empty note and activates it', async () => {
    const { result, storage, tick } = await setup([note('a', 1)]);
    act(() => result.current.updateActive({ title: 'A2' }));
    tick();
    await act(async () => {
      await result.current.createNote();
    });

    const created = result.current.activeNote;
    expect(created).toMatchObject({ title: '', content: EMPTY_DOC });
    expect(created?.id).not.toBe('a');
    expect(result.current.notes.map((n) => n.id)).toEqual([created?.id, 'a']);
    expect(storage.put.mock.calls.map(([n]) => n.title)).toEqual(['A2', '']);
  });

  it('deleteNote removes the note and activates the newest remaining one', async () => {
    const { result, storage } = await setup([note('a', 1), note('b', 2), note('c', 3)]);
    await act(async () => {
      await result.current.deleteNote('c');
    });

    expect(storage.remove).toHaveBeenCalledWith('c');
    expect(result.current.notes.map((n) => n.id)).toEqual(['b', 'a']);
    expect(result.current.activeNote?.id).toBe('b');
  });

  it('deleting an inactive note keeps the active note', async () => {
    const { result } = await setup([note('a', 1), note('b', 2)]);
    await act(async () => {
      await result.current.deleteNote('a');
    });
    expect(result.current.activeNote?.id).toBe('b');
  });

  it('deleting the last note creates a fresh empty note', async () => {
    const { result, storage } = await setup([note('a', 1)]);
    await act(async () => {
      await result.current.deleteNote('a');
    });

    expect(result.current.notes).toHaveLength(1);
    expect(result.current.activeNote?.id).not.toBe('a');
    expect(result.current.activeNote?.title).toBe('');
    expect(storage.put).toHaveBeenCalledWith(result.current.activeNote);
  });

  it('deleting the active note drops its pending save', async () => {
    const { result, storage } = await setup([note('a', 1), note('b', 2)]);
    act(() => result.current.updateActive({ title: 'gone' }));
    await act(async () => {
      await result.current.deleteNote('b');
    });
    act(() => vi.advanceTimersByTime(1000));
    expect(storage.put).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'gone' }));
  });

  it('flushes the pending save on unmount', async () => {
    const { result, storage, unmount } = await setup([note('a', 1)]);
    act(() => result.current.updateActive({ title: 'bye' }));
    unmount();
    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ title: 'bye' }));
  });

  it('flushes the pending save when the page is hidden', async () => {
    const { result, storage } = await setup([note('a', 1)]);
    act(() => result.current.updateActive({ title: 'hidden' }));
    window.dispatchEvent(new Event('pagehide'));
    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ title: 'hidden' }));
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/notes/useNotes.test.ts`
Expected: FAIL，`Failed to resolve import "./useNotes" from "src/notes/useNotes.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/notes/useNotes.ts`：

```ts
import type { JSONContent, Note } from '@oc/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NoteStorage } from '../platform/types';
import { debounce } from './debounce';
import { createNote as makeNote, sortByUpdatedDesc } from './noteStore';

export const SAVE_DELAY_MS = 500;

export interface NotePatch {
  title?: string;
  content?: JSONContent;
}

export interface UseNotesOptions {
  /** Clock for createdAt/updatedAt; injectable for tests. */
  now?: () => number;
  saveDelayMs?: number;
}

export interface UseNotesResult {
  /** Newest `updatedAt` first. */
  notes: Note[];
  activeNote: Note | undefined;
  loading: boolean;
  createNote(): Promise<Note>;
  selectNote(id: string): void;
  deleteNote(id: string): Promise<void>;
  updateActive(patch: NotePatch): void;
}

export function useNotes(storage: NoteStorage, options: UseNotesOptions = {}): UseNotesResult {
  const now = useRef(options.now ?? Date.now).current;
  const saveDelayMs = options.saveDelayMs ?? SAVE_DELAY_MS;

  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  // Refs mirror the state so callbacks always see the latest values synchronously.
  const notesRef = useRef<Note[]>([]);
  const activeIdRef = useRef<string | undefined>(undefined);
  const pendingRef = useRef<Note | undefined>(undefined);

  const commit = useCallback((next: Note[], nextActiveId: string | undefined) => {
    notesRef.current = next;
    activeIdRef.current = nextActiveId;
    setNotes(next);
    setActiveId(nextActiveId);
  }, []);

  const saver = useMemo(
    () =>
      debounce(() => {
        const note = pendingRef.current;
        pendingRef.current = undefined;
        if (note) {
          storage.put(note).catch((error: unknown) => console.error('Failed to save note', error));
        }
      }, saveDelayMs),
    [storage, saveDelayMs],
  );

  useEffect(() => {
    const flush = () => saver.flush();
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') saver.flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      saver.flush();
    };
  }, [saver]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let list = await storage.list();
      if (cancelled) return;
      if (list.length === 0) {
        const first = makeNote(now());
        await storage.put(first);
        if (cancelled) return;
        list = [first];
      }
      commit(list, list[0].id);
      setLoading(false);
    };
    load().catch((error: unknown) => console.error('Failed to load notes', error));
    return () => {
      cancelled = true;
    };
  }, [storage, now, commit]);

  const createNote = useCallback(async () => {
    saver.flush();
    const note = makeNote(now());
    await storage.put(note);
    commit(sortByUpdatedDesc([note, ...notesRef.current]), note.id);
    return note;
  }, [storage, now, saver, commit]);

  const selectNote = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) return;
      if (!notesRef.current.some((n) => n.id === id)) return;
      saver.flush();
      commit(notesRef.current, id);
    },
    [saver, commit],
  );

  const deleteNote = useCallback(
    async (id: string) => {
      if (pendingRef.current?.id === id) {
        saver.cancel();
        pendingRef.current = undefined;
      }
      await storage.remove(id);
      const remaining = notesRef.current.filter((n) => n.id !== id);
      if (remaining.length === 0) {
        const fresh = makeNote(now());
        await storage.put(fresh);
        commit([fresh], fresh.id);
        return;
      }
      const nextActiveId = activeIdRef.current === id ? remaining[0].id : activeIdRef.current;
      commit(remaining, nextActiveId);
    },
    [storage, now, saver, commit],
  );

  const updateActive = useCallback(
    (patch: NotePatch) => {
      const id = activeIdRef.current;
      const current = notesRef.current.find((n) => n.id === id);
      if (!current) return;
      const updated: Note = {
        ...current,
        title: patch.title ?? current.title,
        content: patch.content ?? current.content,
        updatedAt: now(),
      };
      commit(
        sortByUpdatedDesc(notesRef.current.map((n) => (n.id === updated.id ? updated : n))),
        updated.id,
      );
      pendingRef.current = updated;
      saver();
    },
    [now, saver, commit],
  );

  const activeNote = useMemo(() => notes.find((n) => n.id === activeId), [notes, activeId]);

  return { notes, activeNote, loading, createNote, selectNote, deleteNote, updateActive };
}
```

設計重點：
- `notesRef`／`activeIdRef` 與 state 同步更新，所有 callback 都是穩定參考，且永遠讀到最新值。
- 只有作用中筆記會被編輯，所以待存檔只需一個槽位 `pendingRef`。
- 載入 effect 用 `cancelled` 旗標：React StrictMode 開發模式會先執行一次再清除，第一輪在 `list()` 回來前已被取消，不會建立兩篇空白筆記。

- [ ] **Step 4: 執行測試與型別檢查，確認通過**

Run: `npm test -w @oc/core -- src/notes/useNotes.test.ts && npm run typecheck -w @oc/core`
Expected: `Tests  13 passed (13)`；typecheck 無錯誤。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/notes/useNotes.ts packages/core/src/notes/useNotes.test.ts
git commit -m "feat(core): add useNotes hook with debounced autosave"
```

---

### Task 11: Tiptap 擴充組合 `createExtensions`

**Files:**
- Create: `packages/core/src/editor/extensions.ts`
- Test: `packages/core/src/editor/extensions.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/editor/extensions.test.ts`：

```ts
import { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createExtensions, EDITOR_PLACEHOLDER } from './extensions';

let editor: Editor | undefined;

function makeEditor(html = '<p>Hello</p>') {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createExtensions(),
    content: html,
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

describe('createExtensions', () => {
  it('supports bold, italic and underline', () => {
    const e = makeEditor();
    e.chain().selectAll().toggleBold().toggleItalic().toggleUnderline().run();
    expect(e.isActive('bold')).toBe(true);
    expect(e.isActive('italic')).toBe(true);
    expect(e.isActive('underline')).toBe(true);
  });

  it('supports text color through TextStyle + Color', () => {
    const e = makeEditor();
    e.chain().selectAll().setColor('#dc2626').run();
    expect(e.getAttributes('textStyle').color).toBe('#dc2626');
    // jsdom normalises the inline style to rgb(), so only check that a coloured span exists.
    expect(e.getHTML()).toContain('<span style="color:');
  });

  it('supports multicolor highlight', () => {
    const e = makeEditor();
    e.chain().selectAll().setHighlight({ color: '#fef08a' }).run();
    expect(e.getAttributes('highlight').color).toBe('#fef08a');
    expect(e.getHTML()).toContain('<mark data-color="#fef08a"');
  });

  it('aligns paragraphs and headings', () => {
    const e = makeEditor('<p>a</p><h2>b</h2>');
    e.chain().selectAll().setTextAlign('right').run();
    const html = e.getHTML();
    expect(html).toContain('<p style="text-align: right;">a</p>');
    expect(html).toContain('<h2 style="text-align: right;">b</h2>');
  });

  it('supports headings 1-3 and both list types', () => {
    const e = makeEditor();
    // Put the cursor inside "Hello" (position 1 is the start of the first paragraph).
    e.chain().setTextSelection(2).setHeading({ level: 3 }).run();
    expect(e.isActive('heading', { level: 3 })).toBe(true);
    e.chain().setParagraph().toggleBulletList().run();
    expect(e.isActive('bulletList')).toBe(true);
    e.chain().toggleOrderedList().run();
    expect(e.isActive('orderedList')).toBe(true);
  });

  it('supports undo and redo', () => {
    const e = makeEditor('<p>Hello</p>');
    e.chain().selectAll().insertContent('Bye').run();
    expect(e.getText()).toBe('Bye');
    e.commands.undo();
    expect(e.getText()).toBe('Hello');
    e.commands.redo();
    expect(e.getText()).toBe('Bye');
  });

  it('shows the zh-TW placeholder on an empty document', () => {
    const e = makeEditor('<p></p>');
    expect(EDITOR_PLACEHOLDER).toBe('在這裡開始編寫筆記..');
    const empty = e.view.dom.querySelector('p');
    expect(empty).toHaveAttribute('data-placeholder', '在這裡開始編寫筆記..');
  });
});
```

注意：StarterKit v3 內含 `TrailingNode`，文件結尾若是標題會自動補一個空段落，所以對齊測試用 `toContain` 而非整段比對；區塊層級的測試把游標放在段落內而非 `selectAll()`。

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/editor/extensions.test.ts`
Expected: FAIL，`Failed to resolve import "./extensions" from "src/editor/extensions.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/editor/extensions.ts`：

```ts
import type { Extensions } from '@tiptap/react';
import { Highlight } from '@tiptap/extension-highlight';
import { TextAlign } from '@tiptap/extension-text-align';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import { Placeholder } from '@tiptap/extensions';
import { StarterKit } from '@tiptap/starter-kit';

export const EDITOR_PLACEHOLDER = '在這裡開始編寫筆記..';

export function createExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
    }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Placeholder.configure({ placeholder: EDITOR_PLACEHOLDER }),
  ];
}
```

Tiptap v3 的 StarterKit 已含 `Underline` 與 `UndoRedo`，不要再另外加入（會出現重複擴充警告）。`Extensions` 型別從 `@tiptap/react` 取（它重新匯出 `@tiptap/core`），避免引用未宣告的依賴。

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/editor/extensions.test.ts`
Expected: `Tests  7 passed (7)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/editor/extensions.ts packages/core/src/editor/extensions.test.ts
git commit -m "feat(core): configure Tiptap extensions with zh-TW placeholder"
```

---

### Task 12: `useNoteEditor` 與 `Editor`

**Files:**
- Create: `packages/core/src/editor/useNoteEditor.ts`
- Create: `packages/core/src/editor/Editor.tsx`
- Test: `packages/core/src/editor/Editor.test.tsx`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/editor/Editor.test.tsx`：

```tsx
import type { JSONContent } from '@oc/shared';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Editor } from './Editor';
import { useNoteEditor } from './useNoteEditor';

const doc = (text?: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }],
});

function Harness(props: {
  noteId: string;
  content: JSONContent;
  onChange: (content: JSONContent) => void;
  editorRef?: { current: TiptapEditor | null };
}) {
  const editor = useNoteEditor({
    noteId: props.noteId,
    content: props.content,
    onChange: props.onChange,
  });
  if (props.editorRef) props.editorRef.current = editor;
  return <Editor editor={editor} />;
}

describe('Editor + useNoteEditor', () => {
  it('renders the note content in a labelled textbox', () => {
    render(<Harness noteId="a" content={doc('Hello')} onChange={vi.fn()} />);
    const box = screen.getByRole('textbox', { name: '筆記內文' });
    expect(box).toHaveTextContent('Hello');
  });

  it('shows the placeholder for an empty note', () => {
    render(<Harness noteId="a" content={doc()} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: '筆記內文' }).querySelector('p')).toHaveAttribute(
      'data-placeholder',
      '在這裡開始編寫筆記..',
    );
  });

  it('reports edits as Tiptap JSON', () => {
    const onChange = vi.fn();
    const editorRef = { current: null as TiptapEditor | null };
    render(<Harness noteId="a" content={doc('Hello')} onChange={onChange} editorRef={editorRef} />);

    act(() => {
      editorRef.current?.chain().setTextSelection(6).insertContent('!').run();
    });

    expect(onChange).toHaveBeenLastCalledWith({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: null },
          content: [{ type: 'text', text: 'Hello!' }],
        },
      ],
    });
  });

  it('loads the new note and starts a fresh undo history when noteId changes', () => {
    const editorRef = { current: null as TiptapEditor | null };
    const { rerender } = render(
      <Harness noteId="a" content={doc('First')} onChange={vi.fn()} editorRef={editorRef} />,
    );
    act(() => {
      editorRef.current?.commands.insertContent('x');
    });

    rerender(<Harness noteId="b" content={doc('Second')} onChange={vi.fn()} editorRef={editorRef} />);

    expect(screen.getByRole('textbox', { name: '筆記內文' })).toHaveTextContent('Second');
    expect(editorRef.current?.can().undo()).toBe(false);
  });

  it('ignores content prop changes for the same note (no reset while typing)', () => {
    const { rerender } = render(<Harness noteId="a" content={doc('Typed')} onChange={vi.fn()} />);
    rerender(<Harness noteId="a" content={doc('Stale')} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: '筆記內文' })).toHaveTextContent('Typed');
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/editor/Editor.test.tsx`
Expected: FAIL，`Failed to resolve import "./Editor" from "src/editor/Editor.test.tsx". Does the file exist?`

- [ ] **Step 3: 實作 hook**

`packages/core/src/editor/useNoteEditor.ts`：

```ts
import type { JSONContent } from '@oc/shared';
import { useEditor, type Editor as TiptapEditor } from '@tiptap/react';
import { useMemo } from 'react';
import { createExtensions } from './extensions';

export interface UseNoteEditorOptions {
  /** The editor is recreated (fresh content + undo history) whenever this changes. */
  noteId: string | undefined;
  /** Initial content; later changes for the same noteId are ignored. */
  content: JSONContent;
  onChange(content: JSONContent): void;
}

export function useNoteEditor({ noteId, content, onChange }: UseNoteEditorOptions): TiptapEditor {
  const extensions = useMemo(() => createExtensions(), []);
  return useEditor(
    {
      immediatelyRender: true,
      extensions,
      content,
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': '筆記內文',
          class: 'oc-prose',
        },
      },
      // useEditor always calls the latest onUpdate, so a fresh closure per render is fine.
      onUpdate: ({ editor }) => onChange(editor.getJSON()),
    },
    [noteId],
  );
}
```

依據 `@tiptap/react` 3.x 原始碼：`useEditor(options, deps)` 在 deps 改變時銷毀並以最新 options 重建 editor；deps 非空且未變時不會套用新 options（因此同一篇筆記的 `content` 變動不會重設編輯器）；`onUpdate` 等回呼永遠轉呼叫最新一次 render 傳入的版本。

- [ ] **Step 4: 實作元件**

`packages/core/src/editor/Editor.tsx`：

```tsx
import { EditorContent, type Editor as TiptapEditor } from '@tiptap/react';

export function Editor({ editor }: { editor: TiptapEditor }) {
  return <EditorContent editor={editor} className="oc-editor" />;
}
```

- [ ] **Step 5: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/editor/Editor.test.tsx`
Expected: `Tests  5 passed (5)`

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/editor/useNoteEditor.ts packages/core/src/editor/Editor.tsx packages/core/src/editor/Editor.test.tsx
git commit -m "feat(core): add note editor hook and Editor component"
```

---

### Task 13: 調色盤 `palettes` 與 `ColorPalette`

**Files:**
- Create: `packages/core/src/editor/palettes.ts`
- Create: `packages/core/src/editor/ColorPalette.tsx`
- Test: `packages/core/src/editor/ColorPalette.test.tsx`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/editor/ColorPalette.test.tsx`：

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ColorPalette } from './ColorPalette';
import { TEXT_COLORS } from './palettes';

function setup(current?: string) {
  const onPick = vi.fn();
  const onClear = vi.fn();
  render(
    <div>
      <ColorPalette
        label="字色"
        icon={<span>A</span>}
        colors={TEXT_COLORS}
        current={current}
        onPick={onPick}
        onClear={onClear}
      />
      <p>outside</p>
    </div>,
  );
  return { onPick, onClear, user: userEvent.setup() };
}

describe('ColorPalette', () => {
  it('opens an 8-colour palette with a clear button', async () => {
    const { user } = setup();
    const toggle = screen.getByRole('button', { name: '字色' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('group', { name: '字色色盤' });
    expect(within(group).getAllByRole('button')).toHaveLength(9);
    expect(within(group).getByRole('button', { name: '清除' })).toBeInTheDocument();
  });

  it('picks a colour and closes', async () => {
    const { user, onPick } = setup();
    await user.click(screen.getByRole('button', { name: '字色' }));
    await user.click(screen.getByRole('button', { name: '紅色' }));

    expect(onPick).toHaveBeenCalledWith('#dc2626');
    expect(screen.queryByRole('group', { name: '字色色盤' })).not.toBeInTheDocument();
  });

  it('clears and closes', async () => {
    const { user, onClear } = setup();
    await user.click(screen.getByRole('button', { name: '字色' }));
    await user.click(screen.getByRole('button', { name: '清除' }));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group', { name: '字色色盤' })).not.toBeInTheDocument();
  });

  it('marks the current colour as pressed', async () => {
    const { user } = setup('#2563eb');
    await user.click(screen.getByRole('button', { name: '字色' }));
    expect(screen.getByRole('button', { name: '藍色' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '紅色' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('closes on Escape and on outside click', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: '字色' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '字色' }));
    await user.click(screen.getByText('outside'));
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/editor/ColorPalette.test.tsx`
Expected: FAIL，`Failed to resolve import "./ColorPalette" from "src/editor/ColorPalette.test.tsx". Does the file exist?`

- [ ] **Step 3: 建立調色盤資料**

`packages/core/src/editor/palettes.ts`：

```ts
export interface Swatch {
  /** zh-TW name, used as the button's accessible name. */
  name: string;
  value: string;
}

export const TEXT_COLORS: readonly Swatch[] = [
  { name: '黑色', value: '#111827' },
  { name: '灰色', value: '#6b7280' },
  { name: '紅色', value: '#dc2626' },
  { name: '橙色', value: '#ea580c' },
  { name: '黃色', value: '#ca8a04' },
  { name: '綠色', value: '#16a34a' },
  { name: '藍色', value: '#2563eb' },
  { name: '紫色', value: '#9333ea' },
];

export const HIGHLIGHT_COLORS: readonly Swatch[] = [
  { name: '黃色', value: '#fef08a' },
  { name: '綠色', value: '#bbf7d0' },
  { name: '藍色', value: '#bfdbfe' },
  { name: '粉紅色', value: '#fbcfe8' },
  { name: '紫色', value: '#e9d5ff' },
  { name: '橙色', value: '#fed7aa' },
  { name: '紅色', value: '#fecaca' },
  { name: '灰色', value: '#e5e7eb' },
];
```

- [ ] **Step 4: 實作 popover 元件**

`packages/core/src/editor/ColorPalette.tsx`：

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Swatch } from './palettes';

export interface ColorPaletteProps {
  label: string;
  icon: ReactNode;
  colors: readonly Swatch[];
  current: string | undefined;
  onPick(color: string): void;
  onClear(): void;
}

export function ColorPalette({ label, icon, colors, current, onPick, onClear }: ColorPaletteProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const choose = (action: () => void) => {
    action();
    setOpen(false);
  };

  return (
    <div className="oc-palette" ref={rootRef}>
      <button
        type="button"
        className="oc-tool"
        aria-label={label}
        title={label}
        aria-haspopup="true"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        <span className="oc-palette-indicator" style={{ background: current ?? 'transparent' }} />
      </button>
      {open && (
        <div className="oc-palette-popover" role="group" aria-label={`${label}色盤`}>
          {colors.map((swatch) => (
            <button
              key={swatch.value}
              type="button"
              className="oc-swatch"
              aria-label={swatch.name}
              title={swatch.name}
              aria-pressed={current === swatch.value}
              style={{ background: swatch.value }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(() => onPick(swatch.value))}
            />
          ))}
          <button
            type="button"
            className="oc-palette-clear"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(onClear)}
          >
            清除
          </button>
        </div>
      )}
    </div>
  );
}
```

`onMouseDown` 的 `preventDefault()` 讓點按鈕時編輯器不失去焦點與選取範圍。

- [ ] **Step 5: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/editor/ColorPalette.test.tsx`
Expected: `Tests  5 passed (5)`

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/editor/palettes.ts packages/core/src/editor/ColorPalette.tsx packages/core/src/editor/ColorPalette.test.tsx
git commit -m "feat(core): add 8-colour palette popover"
```

---

### Task 14: 格式工具列 `Toolbar`

**Files:**
- Create: `packages/core/src/editor/Toolbar.tsx`
- Test: `packages/core/src/editor/Toolbar.test.tsx`

- [ ] **Step 1: 寫失敗的測試**

測試渲染真正的 editor + 工具列，先用 `setTextSelection` 選取 "Hello world"，再用 user-event 點按鈕，最後讀 editor 狀態驗證。M1 不含複製／匯出鈕，測試也確認它們不存在。

`packages/core/src/editor/Toolbar.test.tsx`：

```tsx
import type { Editor as TiptapEditor } from '@tiptap/react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Editor } from './Editor';
import { Toolbar } from './Toolbar';
import { useNoteEditor } from './useNoteEditor';

function Harness({ editorRef }: { editorRef: { current: TiptapEditor | null } }) {
  const editor = useNoteEditor({
    noteId: 'n1',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
    },
    onChange: () => undefined,
  });
  editorRef.current = editor;
  return (
    <>
      <Toolbar editor={editor} />
      <Editor editor={editor} />
    </>
  );
}

function setup() {
  const editorRef = { current: null as TiptapEditor | null };
  render(<Harness editorRef={editorRef} />);
  const editor = editorRef.current as TiptapEditor;
  // Select "Hello world" (positions 1..12 inside the first paragraph).
  act(() => {
    editor.commands.setTextSelection({ from: 1, to: 12 });
  });
  return { editor, user: userEvent.setup() };
}

const button = (name: string) => screen.getByRole('button', { name });

describe('Toolbar', () => {
  it('renders every M1 control and no copy/export buttons', () => {
    setup();
    expect(screen.getByRole('toolbar', { name: '格式工具列' })).toBeInTheDocument();
    for (const name of [
      '復原', '重做', '粗體', '斜體', '底線', '字色', '螢光筆',
      '靠左', '置中', '靠右', '項目清單', '編號清單',
    ]) {
      expect(button(name)).toBeInTheDocument();
    }
    expect(screen.getByRole('combobox', { name: '段落樣式' })).toHaveValue('paragraph');
    expect(screen.queryByRole('button', { name: /複製|匯出/ })).not.toBeInTheDocument();
  });

  it('toggles bold, italic and underline and reflects the state', async () => {
    const { editor, user } = setup();
    await user.click(button('粗體'));
    await user.click(button('斜體'));
    await user.click(button('底線'));

    expect(editor.isActive('bold')).toBe(true);
    expect(editor.isActive('italic')).toBe(true);
    expect(editor.isActive('underline')).toBe(true);
    expect(button('粗體')).toHaveAttribute('aria-pressed', 'true');

    await user.click(button('粗體'));
    expect(editor.isActive('bold')).toBe(false);
    expect(button('粗體')).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches the block style between 正文 and 標題 1-3', async () => {
    const { editor, user } = setup();
    const select = screen.getByRole('combobox', { name: '段落樣式' });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '正文', '標題 1', '標題 2', '標題 3',
    ]);

    await user.selectOptions(select, '標題 2');
    expect(editor.isActive('heading', { level: 2 })).toBe(true);
    expect(select).toHaveValue('h2');

    await user.selectOptions(select, '正文');
    expect(editor.isActive('paragraph')).toBe(true);
    expect(select).toHaveValue('paragraph');
  });

  it('applies and clears text colour from the palette', async () => {
    const { editor, user } = setup();
    await user.click(button('字色'));
    await user.click(button('紅色'));
    expect(editor.getAttributes('textStyle').color).toBe('#dc2626');

    await user.click(button('字色'));
    await user.click(button('清除'));
    expect(editor.getAttributes('textStyle').color).toBeUndefined();
  });

  it('applies and clears highlight from the palette', async () => {
    const { editor, user } = setup();
    await user.click(button('螢光筆'));
    await user.click(button('黃色'));
    expect(editor.getAttributes('highlight').color).toBe('#fef08a');

    await user.click(button('螢光筆'));
    await user.click(button('清除'));
    expect(editor.isActive('highlight')).toBe(false);
  });

  it('aligns left, center and right', async () => {
    const { editor, user } = setup();
    expect(button('靠左')).toHaveAttribute('aria-pressed', 'true');

    await user.click(button('置中'));
    expect(editor.isActive({ textAlign: 'center' })).toBe(true);
    expect(button('置中')).toHaveAttribute('aria-pressed', 'true');

    await user.click(button('靠右'));
    expect(editor.isActive({ textAlign: 'right' })).toBe(true);

    await user.click(button('靠左'));
    expect(editor.isActive({ textAlign: 'left' })).toBe(true);
  });

  it('toggles bullet and ordered lists', async () => {
    const { editor, user } = setup();
    await user.click(button('項目清單'));
    expect(editor.isActive('bulletList')).toBe(true);
    expect(button('項目清單')).toHaveAttribute('aria-pressed', 'true');

    await user.click(button('編號清單'));
    expect(editor.isActive('orderedList')).toBe(true);
    expect(editor.isActive('bulletList')).toBe(false);
  });

  it('enables undo/redo only when there is history', async () => {
    const { editor, user } = setup();
    expect(button('復原')).toBeDisabled();
    expect(button('重做')).toBeDisabled();

    await user.click(button('粗體'));
    expect(button('復原')).toBeEnabled();

    await user.click(button('復原'));
    expect(editor.isActive('bold')).toBe(false);
    expect(button('重做')).toBeEnabled();

    await user.click(button('重做'));
    expect(editor.isActive('bold')).toBe(true);
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/editor/Toolbar.test.tsx`
Expected: FAIL，`Failed to resolve import "./Toolbar" from "src/editor/Toolbar.test.tsx". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/editor/Toolbar.tsx`：

```tsx
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

export function Toolbar({ editor }: { editor: TiptapEditor }) {
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
    </div>
  );
}
```

`useEditor` 在 v3 預設不會每個 transaction 都重新 render，所以工具列用 `useEditorState`（預設深比較）訂閱按鈕狀態。

selector 刻意讀 `editor` prop，不讀參數裡的 snapshot：`@tiptap/react` 3.32 的 `EditorStateManager.watch(nextEditor)` 換上新 editor 時不會遞增 `transactionNumber`，`getSnapshot()` 會一直回傳快取的舊 snapshot（裡面是已銷毀的前一個 editor），直到新 editor 發生第一個 transaction。若讀 snapshot，切換筆記、新增或刪除筆記後（以及首次載入時，載入期間建立的暫用 editor 被換掉後），段落樣式與按鈕亮起狀態都會停在前一個 editor。inline selector 每次 render 都會重新執行，而 `useEditor` 換掉 editor 時 `NotesApp` 會重新 render，因此工具列會立即讀到新 editor。Task 18 的 `toolbar reflects the newly selected note` 測試鎖住這個行為。

- [ ] **Step 4: 執行測試與型別檢查，確認通過**

Run: `npm test -w @oc/core -- src/editor/Toolbar.test.tsx && npm run typecheck -w @oc/core`
Expected: `Tests  8 passed (8)`；typecheck 無錯誤。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/editor/Toolbar.tsx packages/core/src/editor/Toolbar.test.tsx
git commit -m "feat(core): add formatting toolbar"
```

---

### Task 15: 標題輸入框 `TitleInput`

**Files:**
- Create: `packages/core/src/editor/TitleInput.tsx`
- Test: `packages/core/src/editor/TitleInput.test.tsx`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/editor/TitleInput.test.tsx`：

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TitleInput } from './TitleInput';

function Controlled({ onEnter }: { onEnter?: () => void }) {
  const [value, setValue] = useState('');
  return <TitleInput value={value} onChange={setValue} onEnter={onEnter} />;
}

describe('TitleInput', () => {
  it('shows the zh-TW placeholder and the current value', () => {
    render(<TitleInput value="週會" onChange={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: '標題' });
    expect(input).toHaveAttribute('placeholder', '請輸入標題..');
    expect(input).toHaveValue('週會');
  });

  it('reports every change', async () => {
    const onChange = vi.fn();
    render(<TitleInput value="" onChange={onChange} />);
    await userEvent.setup().type(screen.getByRole('textbox', { name: '標題' }), 'A');
    expect(onChange).toHaveBeenCalledWith('A');
  });

  it('works as a controlled input', async () => {
    render(<Controlled />);
    const input = screen.getByRole('textbox', { name: '標題' });
    await userEvent.setup().type(input, '產品會議');
    expect(input).toHaveValue('產品會議');
  });

  it('calls onEnter on Enter', async () => {
    const onEnter = vi.fn();
    render(<Controlled onEnter={onEnter} />);
    await userEvent.setup().type(screen.getByRole('textbox', { name: '標題' }), '{Enter}');
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('ignores Enter while an IME composition is active', () => {
    const onEnter = vi.fn();
    render(<Controlled onEnter={onEnter} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: '標題' }), {
      key: 'Enter',
      isComposing: true,
    });
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('ignores the IME-confirming Enter reported with keyCode 229 (Safari)', () => {
    const onEnter = vi.fn();
    render(<Controlled onEnter={onEnter} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: '標題' }), {
      key: 'Enter',
      keyCode: 229,
    });
    expect(onEnter).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/editor/TitleInput.test.tsx`
Expected: FAIL，`Failed to resolve import "./TitleInput" from "src/editor/TitleInput.test.tsx". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/editor/TitleInput.tsx`：

```tsx
export interface TitleInputProps {
  value: string;
  onChange(value: string): void;
  /** Called on Enter (not while composing Chinese input), e.g. to move focus to the body. */
  onEnter?(): void;
}

export function TitleInput({ value, onChange, onEnter }: TitleInputProps) {
  return (
    <input
      type="text"
      className="oc-title"
      aria-label="標題"
      placeholder="請輸入標題.."
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        // Safari fires the IME-confirming Enter after compositionend with keyCode 229.
        if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
          event.preventDefault();
          onEnter?.();
        }
      }}
    />
  );
}
```

`isComposing` 與 `keyCode !== 229` 兩個檢查讓注音／倉頡選字時按 Enter 只確認選字，不會跳到內文。Chrome／Edge 在選字確認的 Enter 上帶 `isComposing === true`；Safari／WebKit（macOS 網頁版與之後 iOS 的 WKWebView）則先送出 `compositionend`，再送出 `isComposing === false`、`keyCode === 229` 的 keydown，只看 `isComposing` 會讓每次選字都跳到內文。開發機是 Windows，沒有 Safari，所以 Safari 的行為由第 6 個測試以 `keyCode: 229` 模擬鎖住。

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/editor/TitleInput.test.tsx`
Expected: `Tests  6 passed (6)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/editor/TitleInput.tsx packages/core/src/editor/TitleInput.test.tsx
git commit -m "feat(core): add title input with IME-safe Enter"
```

---

### Task 16: 筆記清單 `NoteList`

**Files:**
- Create: `packages/core/src/components/NoteList.tsx`
- Test: `packages/core/src/components/NoteList.test.tsx`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/components/NoteList.test.tsx`：

```tsx
import { EMPTY_DOC, type Note } from '@oc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NoteList } from './NoteList';

const note = (id: string, title: string, updatedAt: number): Note => ({
  id,
  title,
  content: EMPTY_DOC,
  createdAt: updatedAt,
  updatedAt,
});

const NOTES = [note('b', '週會紀錄', 2), note('a', '', 1)];

function setup(activeId = 'b') {
  const handlers = { onSelect: vi.fn(), onCreate: vi.fn(), onDelete: vi.fn() };
  render(<NoteList notes={NOTES} activeId={activeId} {...handlers} />);
  return { ...handlers, user: userEvent.setup() };
}

describe('NoteList', () => {
  it('lists notes in the given order with 未命名筆記 for blank titles', () => {
    setup();
    const items = within(screen.getByRole('list', { name: '筆記清單' })).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('.oc-note-title')?.textContent)).toEqual([
      '週會紀錄',
      '未命名筆記',
    ]);
  });

  it('marks the active note', () => {
    setup('b');
    expect(screen.getByRole('button', { name: /^週會紀錄/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /^未命名筆記/ })).not.toHaveAttribute('aria-current');
  });

  it('selects a note', async () => {
    const { user, onSelect } = setup();
    await user.click(screen.getByRole('button', { name: /^未命名筆記/ }));
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('creates a note', async () => {
    const { user, onCreate } = setup();
    await user.click(screen.getByRole('button', { name: '新增筆記' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('deletes a note without selecting it', async () => {
    const { user, onDelete, onSelect } = setup();
    await user.click(screen.getByRole('button', { name: '刪除「週會紀錄」' }));
    expect(onDelete).toHaveBeenCalledWith('b');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
```

選取鈕的可及名稱是「標題 + 時間」，刪除鈕是「刪除「標題」」，所以測試用 `/^標題/` 錨定開頭來區分兩者；時間字串依時區而異，測試不比對它。

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/components/NoteList.test.tsx`
Expected: FAIL，`Failed to resolve import "./NoteList" from "src/components/NoteList.test.tsx". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/components/NoteList.tsx`：

```tsx
import type { Note } from '@oc/shared';
import { Plus, Trash } from 'lucide-react';
import { displayTitle } from '../notes/noteStore';

export interface NoteListProps {
  /** Already sorted newest first. */
  notes: Note[];
  activeId: string | undefined;
  onSelect(id: string): void;
  onCreate(): void;
  onDelete(id: string): void;
}

const timeFormat = new Intl.DateTimeFormat('zh-TW', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function NoteList({ notes, activeId, onSelect, onCreate, onDelete }: NoteListProps) {
  return (
    <nav className="oc-notelist" aria-label="筆記">
      <div className="oc-notelist-header">
        <h2>筆記</h2>
        <button
          type="button"
          className="oc-icon-btn"
          aria-label="新增筆記"
          title="新增筆記"
          onClick={onCreate}
        >
          <Plus size={18} />
        </button>
      </div>
      <ul className="oc-notelist-items" aria-label="筆記清單">
        {notes.map((note) => {
          const title = displayTitle(note);
          const active = note.id === activeId;
          return (
            <li key={note.id} className={active ? 'oc-note-item is-active' : 'oc-note-item'}>
              <button
                type="button"
                className="oc-note-select"
                aria-current={active ? 'true' : undefined}
                onClick={() => onSelect(note.id)}
              >
                <span className="oc-note-title">{title}</span>
                <time className="oc-note-time" dateTime={new Date(note.updatedAt).toISOString()}>
                  {timeFormat.format(note.updatedAt)}
                </time>
              </button>
              <button
                type="button"
                className="oc-note-delete"
                aria-label={`刪除「${title}」`}
                title="刪除"
                onClick={() => onDelete(note.id)}
              >
                <Trash size={16} />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/components/NoteList.test.tsx`
Expected: `Tests  5 passed (5)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/components/NoteList.tsx packages/core/src/components/NoteList.test.tsx
git commit -m "feat(core): add note list sidebar"
```

---

### Task 17: `ActionBar` 與 `Banner`

**Files:**
- Create: `packages/core/src/components/ActionBar.tsx`
- Create: `packages/core/src/components/Banner.tsx`
- Test: `packages/core/src/components/ActionBar.test.tsx`
- Test: `packages/core/src/components/Banner.test.tsx`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/components/ActionBar.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActionBar } from './ActionBar';

describe('ActionBar', () => {
  it('shows a disabled 錄製 button marked 即將推出', () => {
    render(<ActionBar />);
    const record = screen.getByRole('button', { name: '錄製' });
    expect(record).toBeDisabled();
    expect(record).toHaveAttribute('title', '即將推出');
  });

  it('shows the four locked AI buttons in order', () => {
    render(<ActionBar />);
    const labels = ['AI 摘要', '待辦事項', 'AI 助理', 'AI 對話'];
    const buttons = labels.map((name) => screen.getByRole('button', { name }));
    for (const button of buttons) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button.querySelector('svg')).not.toBeNull();
    }
    const aiButtons = Array.from(document.querySelectorAll('.oc-ai-btn')).map((b) => b.textContent);
    expect(aiButtons).toEqual(labels);
  });
});
```

`packages/core/src/components/Banner.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Banner } from './Banner';

describe('Banner', () => {
  it('shows the open-copilot recording tip', () => {
    render(<Banner />);
    const banner = screen.getByRole('note');
    expect(banner).toHaveTextContent(
      '手動輸入累了？ 按「錄製」，open-copilot 幫你把語音轉成文字，你只需要專注思考。',
    );
    expect(banner.querySelector('strong')).toHaveTextContent('手動輸入累了？');
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/components/ActionBar.test.tsx src/components/Banner.test.tsx`
Expected: 兩個檔案都 FAIL，`Failed to resolve import "./ActionBar"` 與 `Failed to resolve import "./Banner"`。

- [ ] **Step 3: 實作**

`packages/core/src/components/ActionBar.tsx`：

```tsx
import { Lock, Mic } from 'lucide-react';

export const AI_FEATURES = ['AI 摘要', '待辦事項', 'AI 助理', 'AI 對話'] as const;

export function ActionBar() {
  return (
    <div className="oc-actionbar">
      <button type="button" className="oc-record-btn" disabled title="即將推出">
        <Mic size={18} aria-hidden="true" />
        <span>錄製</span>
      </button>
      <div className="oc-ai-group">
        {AI_FEATURES.map((label) => (
          <button
            key={label}
            type="button"
            className="oc-ai-btn"
            disabled
            aria-disabled="true"
            title="即將推出"
          >
            <Lock size={14} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

`packages/core/src/components/Banner.tsx`：

```tsx
export function Banner() {
  return (
    <div className="oc-banner" role="note">
      <strong>手動輸入累了？</strong> 按「錄製」，open-copilot 幫你把語音轉成文字，你只需要專注思考。
    </div>
  );
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/components/ActionBar.test.tsx src/components/Banner.test.tsx`
Expected: `Tests  3 passed (3)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/components/ActionBar.tsx packages/core/src/components/ActionBar.test.tsx packages/core/src/components/Banner.tsx packages/core/src/components/Banner.test.tsx
git commit -m "feat(core): add action bar with locked AI buttons and recording banner"
```

---

### Task 18: `NotesApp` 組裝與樣式（含 < 768px 抽屜）

**Files:**
- Create: `packages/core/src/NotesApp.tsx`
- Create: `packages/core/src/styles/app.css`
- Test: `packages/core/src/NotesApp.test.tsx`

- [ ] **Step 1: 寫失敗的測試**

jsdom 不會套用 CSS media query，所以抽屜在這裡只驗證 `data-drawer-open` 與 `aria-expanded`；實際的窄螢幕顯示／隱藏由 Task 21 的 Playwright 測試驗證。`window.confirm` 以 `vi.spyOn` 控制。

`packages/core/src/NotesApp.test.tsx`：

```tsx
import type { JSONContent, Note } from '@oc/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotesApp } from './NotesApp';
import { PlatformProvider } from './platform/PlatformContext';
import { createTestPlatform } from './test/memoryStorage';

const doc = (text: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const note = (id: string, title: string, text: string, updatedAt: number): Note => ({
  id,
  title,
  content: doc(text),
  createdAt: updatedAt,
  updatedAt,
});

async function renderApp(initial: Note[] = []) {
  const ctx = createTestPlatform(initial);
  render(
    <PlatformProvider platform={ctx.platform}>
      <NotesApp />
    </PlatformProvider>,
  );
  await screen.findByRole('textbox', { name: '標題' });
  return { ...ctx, user: userEvent.setup() };
}

const titleInput = () => screen.getByRole('textbox', { name: '標題' });
const body = () => screen.getByRole('textbox', { name: '筆記內文' });
const list = () => screen.getByRole('list', { name: '筆記清單' });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NotesApp', () => {
  it('starts with one empty note when storage is empty', async () => {
    await renderApp();
    expect(titleInput()).toHaveValue('');
    expect(titleInput()).toHaveAttribute('placeholder', '請輸入標題..');
    expect(within(list()).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list()).getByText('未命名筆記')).toBeInTheDocument();
  });

  it('renders the action bar, banner and toolbar', async () => {
    await renderApp();
    expect(screen.getByRole('button', { name: '錄製' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'AI 摘要' })).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent('手動輸入累了？');
    expect(screen.getByRole('toolbar', { name: '格式工具列' })).toBeInTheDocument();
  });

  it('shows a typed title in the list and saves it', async () => {
    const { user, storage } = await renderApp();
    await user.type(titleInput(), '週會');

    expect(within(list()).getByRole('button', { name: /^週會/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(storage.put).toHaveBeenLastCalledWith(expect.objectContaining({ title: '週會' })),
    );
  });

  it('creates a new note and makes it active', async () => {
    const { user } = await renderApp([note('a', 'A', 'Alpha', 1)]);
    await user.click(screen.getByRole('button', { name: '新增筆記' }));

    await waitFor(() => expect(within(list()).getAllByRole('listitem')).toHaveLength(2));
    expect(titleInput()).toHaveValue('');
    expect(body()).not.toHaveTextContent('Alpha');
  });

  it('switches between notes', async () => {
    const { user } = await renderApp([note('a', 'A', 'Alpha', 1), note('b', 'B', 'Beta', 2)]);
    expect(titleInput()).toHaveValue('B');
    expect(body()).toHaveTextContent('Beta');

    await user.click(within(list()).getByRole('button', { name: /^A/ }));

    expect(titleInput()).toHaveValue('A');
    expect(body()).toHaveTextContent('Alpha');
  });

  it('toolbar reflects the newly selected note', async () => {
    const a: Note = {
      id: 'a',
      title: 'A',
      createdAt: 1,
      updatedAt: 1,
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Alpha' }] },
        ],
      },
    };
    const { user } = await renderApp([a, note('b', 'B', 'Beta', 2)]);

    await user.click(screen.getByRole('button', { name: '項目清單' }));
    expect(screen.getByRole('button', { name: '項目清單' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(list()).getByRole('button', { name: /^A/ }));

    expect(screen.getByRole('combobox', { name: '段落樣式' })).toHaveValue('h1');
    expect(screen.getByRole('button', { name: '項目清單' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '復原' })).toBeDisabled();
  });

  it('deletes a note only after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { user, storage } = await renderApp([
      note('a', 'A', 'Alpha', 1),
      note('b', 'B', 'Beta', 2),
    ]);

    await user.click(screen.getByRole('button', { name: '刪除「B」' }));
    expect(confirm).toHaveBeenLastCalledWith('確定要刪除「B」嗎？此動作無法復原。');
    expect(storage.remove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '刪除「B」' }));
    await waitFor(() => expect(within(list()).getAllByRole('listitem')).toHaveLength(1));
    expect(storage.remove).toHaveBeenCalledWith('b');
    expect(titleInput()).toHaveValue('A');
  });

  it('moves focus to the body when Enter is pressed in the title', async () => {
    const { user } = await renderApp();
    await user.type(titleInput(), '標題{Enter}');
    await waitFor(() => expect(body()).toHaveFocus());
  });

  it('opens and closes the note drawer from the menu button', async () => {
    const { user } = await renderApp([note('a', 'A', 'Alpha', 1), note('b', 'B', 'Beta', 2)]);
    const app = document.querySelector('.oc-app');
    expect(app).toHaveAttribute('data-drawer-open', 'false');

    await user.click(screen.getByRole('button', { name: '開啟筆記清單' }));
    expect(app).toHaveAttribute('data-drawer-open', 'true');
    expect(screen.getByRole('button', { name: '關閉筆記清單' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    await user.click(within(list()).getByRole('button', { name: /^A/ }));
    expect(app).toHaveAttribute('data-drawer-open', 'false');
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/NotesApp.test.tsx`
Expected: FAIL，`Failed to resolve import "./NotesApp" from "src/NotesApp.test.tsx". Does the file exist?`

- [ ] **Step 3: 建立樣式**

`packages/core/src/styles/app.css`：

```css
:root {
  --oc-primary: #c026d3;
  --oc-primary-end: #ec4899;
  --oc-gradient: linear-gradient(135deg, var(--oc-primary) 0%, var(--oc-primary-end) 100%);
  --oc-bg: #ffffff;
  --oc-surface: #f9fafb;
  --oc-hover: #f3f4f6;
  --oc-active-bg: #fdf4ff;
  --oc-border: #e5e7eb;
  --oc-text: #111827;
  --oc-muted: #6b7280;
  --oc-placeholder: #9ca3af;
  --oc-danger: #dc2626;
  --oc-radius: 10px;
  --oc-sidebar-width: 260px;
  --oc-font: system-ui, -apple-system, 'Segoe UI', 'Noto Sans TC', 'PingFang TC',
    'Microsoft JhengHei', sans-serif;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  font-family: var(--oc-font);
  color: var(--oc-text);
  background: var(--oc-bg);
}

button {
  font: inherit;
}

.oc-loading {
  display: grid;
  place-items: center;
  height: 100%;
  color: var(--oc-muted);
}

/* ---------- layout ---------- */
.oc-app {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.oc-sidebar {
  width: var(--oc-sidebar-width);
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--oc-border);
  background: var(--oc-surface);
}

.oc-backdrop {
  display: none;
}

.oc-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.oc-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--oc-border);
}

.oc-menu-btn {
  display: none;
}

/* ---------- action bar ---------- */
.oc-actionbar {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.oc-record-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border: none;
  border-radius: 999px;
  background: var(--oc-gradient);
  color: #ffffff;
  font-weight: 600;
  cursor: pointer;
}

.oc-record-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.oc-ai-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.oc-ai-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--oc-border);
  border-radius: 999px;
  background: var(--oc-bg);
  color: var(--oc-muted);
  font-size: 13px;
  cursor: not-allowed;
}

/* ---------- banner ---------- */
.oc-banner {
  margin: 12px 16px 0;
  padding: 10px 14px;
  border-radius: var(--oc-radius);
  background: linear-gradient(135deg, rgba(192, 38, 211, 0.08), rgba(236, 72, 153, 0.08));
  font-size: 14px;
}

.oc-banner strong {
  color: var(--oc-primary);
}

/* ---------- toolbar ---------- */
.oc-toolbar {
  /* Containing block for the palette popover on narrow screens (see the media query). */
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--oc-border);
}

.oc-tool-group {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 6px;
  margin-right: 2px;
  border-right: 1px solid var(--oc-border);
}

.oc-tool-group:last-child {
  border-right: none;
}

.oc-tool {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--oc-text);
  cursor: pointer;
}

.oc-tool:hover:not(:disabled) {
  background: var(--oc-active-bg);
}

.oc-tool.is-active {
  background: var(--oc-primary);
  color: #ffffff;
}

.oc-tool:disabled {
  color: var(--oc-placeholder);
  cursor: default;
}

.oc-block-select {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--oc-border);
  border-radius: 8px;
  background: var(--oc-bg);
  color: var(--oc-text);
  font: inherit;
}

.oc-palette {
  position: relative;
}

.oc-palette-indicator {
  position: absolute;
  right: 8px;
  bottom: 4px;
  left: 8px;
  height: 3px;
  border-radius: 2px;
}

.oc-palette-popover {
  position: absolute;
  top: 36px;
  left: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: repeat(4, 28px);
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--oc-border);
  border-radius: var(--oc-radius);
  background: var(--oc-bg);
  box-shadow: 0 8px 24px rgba(17, 24, 39, 0.12);
}

.oc-swatch {
  width: 28px;
  height: 28px;
  border: 2px solid #ffffff;
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--oc-border);
  cursor: pointer;
}

.oc-swatch[aria-pressed='true'] {
  box-shadow: 0 0 0 2px var(--oc-primary);
}

.oc-palette-clear {
  grid-column: 1 / -1;
  padding: 4px;
  border: 1px solid var(--oc-border);
  border-radius: 6px;
  background: var(--oc-bg);
  font-size: 13px;
  cursor: pointer;
}

/* ---------- document ---------- */
.oc-document {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px 48px;
}

.oc-title {
  width: 100%;
  padding: 0 0 12px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--oc-text);
  font: inherit;
  font-size: 28px;
  font-weight: 700;
}

.oc-title::placeholder {
  color: var(--oc-placeholder);
}

.oc-editor .ProseMirror {
  min-height: 50vh;
  outline: none;
  font-size: 16px;
  line-height: 1.7;
}

.oc-editor .ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  color: var(--oc-placeholder);
  pointer-events: none;
}

.oc-editor .ProseMirror ul,
.oc-editor .ProseMirror ol {
  padding-left: 1.5em;
}

.oc-editor .ProseMirror mark {
  padding: 0 1px;
  border-radius: 2px;
}

/* ---------- note list ---------- */
.oc-notelist-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 8px;
}

.oc-notelist-header h2 {
  margin: 0;
  font-size: 16px;
}

.oc-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: var(--oc-gradient);
  color: #ffffff;
  cursor: pointer;
}

.oc-notelist-items {
  margin: 0;
  padding: 0 8px 16px;
  list-style: none;
}

.oc-note-item {
  display: flex;
  align-items: center;
  border-radius: var(--oc-radius);
}

.oc-note-item:hover {
  background: var(--oc-hover);
}

.oc-note-item.is-active {
  background: var(--oc-active-bg);
}

.oc-note-select {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.oc-note-title {
  max-width: 100%;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.oc-note-item.is-active .oc-note-title {
  color: var(--oc-primary);
}

.oc-note-time {
  color: var(--oc-muted);
  font-size: 12px;
}

.oc-note-delete {
  display: inline-flex;
  margin-right: 6px;
  padding: 6px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--oc-muted);
  cursor: pointer;
  opacity: 0;
}

.oc-note-item:hover .oc-note-delete,
.oc-note-item.is-active .oc-note-delete,
.oc-note-delete:focus-visible {
  opacity: 1;
}

.oc-note-delete:hover {
  background: #fee2e2;
  color: var(--oc-danger);
}

/* ---------- narrow screens: note list becomes a drawer ---------- */
@media (max-width: 767.98px) {
  .oc-menu-btn {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--oc-text);
    cursor: pointer;
  }

  .oc-sidebar {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 40;
    width: min(80vw, 300px);
    visibility: hidden;
    transform: translateX(-100%);
    transition:
      transform 0.2s ease,
      visibility 0.2s;
    box-shadow: 0 0 24px rgba(17, 24, 39, 0.2);
  }

  .oc-app[data-drawer-open='true'] .oc-sidebar {
    visibility: visible;
    transform: translateX(0);
  }

  .oc-backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: block;
    background: rgba(17, 24, 39, 0.35);
  }

  .oc-note-delete {
    opacity: 1;
  }

  .oc-topbar {
    padding: 8px 12px;
  }

  .oc-banner {
    margin: 8px 12px 0;
  }

  .oc-toolbar {
    padding: 6px 12px;
  }

  /* Anchor the popover to the toolbar, not to its button: on phones the 字色/螢光筆 buttons sit
     near the right edge and a button-anchored popover is clipped by .oc-main's overflow. */
  .oc-palette {
    position: static;
  }

  .oc-palette-popover {
    top: calc(100% + 4px);
    left: 12px;
  }

  .oc-document {
    padding: 16px;
  }

  .oc-title {
    font-size: 22px;
  }
}
```

抽屜關閉時用 `visibility: hidden`（不只 `transform`），讓它離開無障礙樹與 Tab 順序，Playwright 的 `toBeHidden()` 也才成立。

調色盤 popover 寬 152px。桌面版定位在按鈕下方（`.oc-palette` 為 `position: relative`）。寬度 < 768px 時，字色／螢光筆按鈕落在工具列第一列右側，若仍以按鈕為基準，popover 會超出畫面並被 `.oc-main`／`.oc-app` 的 `overflow: hidden` 裁掉（390px 寬時字色的橙色、紫色與螢光筆的藍色、粉紅色、紅色、灰色都點不到）。因此窄螢幕把 `.oc-palette` 改成 `position: static`，popover 改以 `.oc-toolbar`（`position: relative`）為基準，貼齊工具列左側 12px、顯示在工具列下方；320、390、767、1280px 寬時每個色塊都點得到。Task 21 的窄螢幕 e2e 驗證這一點。

- [ ] **Step 4: 實作 `NotesApp`**

`packages/core/src/NotesApp.tsx`：

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
        <Toolbar editor={editor} />
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

`useNoteEditor` 必須在 early return 之前呼叫（hooks 規則）；載入期間 `noteId` 為 `undefined`，載入完成後 `noteId` 改變，editor 以真正的筆記內容重建。

- [ ] **Step 5: 執行測試與型別檢查，確認通過**

Run: `npm test -w @oc/core -- src/NotesApp.test.tsx && npm run typecheck -w @oc/core`
Expected: `Tests  9 passed (9)`；typecheck 無錯誤；輸出中沒有 `not wrapped in act(...)` 警告。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/NotesApp.tsx packages/core/src/NotesApp.test.tsx packages/core/src/styles/app.css
git commit -m "feat(core): assemble NotesApp layout with responsive note drawer"
```

---

### Task 19: `@oc/core` 公開 API

**Files:**
- Create: `packages/core/src/index.ts`
- Test: `packages/core/src/index.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/index.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import * as core from './index';
import type { FileSaver, NoteStorage, Platform } from './index';

describe('@oc/core public API', () => {
  it('exports the app, platform plumbing and storage factories', () => {
    expect(typeof core.NotesApp).toBe('function');
    expect(typeof core.PlatformProvider).toBe('function');
    expect(typeof core.usePlatform).toBe('function');
    expect(typeof core.openAppDb).toBe('function');
    expect(typeof core.createIndexedDbStorage).toBe('function');
    expect(typeof core.createBrowserFileSaver).toBe('function');
  });

  it('builds a working platform from the exported factories', async () => {
    const db = await core.openAppDb(`test-${crypto.randomUUID()}`);
    const storage: NoteStorage = core.createIndexedDbStorage(db);
    const fileSaver: FileSaver = core.createBrowserFileSaver();
    const platform: Platform = { storage, fileSaver, canPrint: true };
    await platform.storage.put({ id: 'x', title: 't', content: {}, createdAt: 1, updatedAt: 1 });
    expect(await platform.storage.get('x')).toMatchObject({ title: 't' });
    db.close();
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/index.test.ts`
Expected: FAIL，`Failed to resolve import "./index" from "src/index.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/index.ts`：

```ts
export { NotesApp } from './NotesApp';
export { PlatformProvider, usePlatform } from './platform/PlatformContext';
export { openAppDb, APP_DB_VERSION } from './platform/db';
export type { AppDbSchema, PendingSegmentRecord } from './platform/db';
export { createIndexedDbStorage } from './platform/indexedDbStorage';
export { createBrowserFileSaver } from './platform/browserFileSaver';
export type { FileSaver, NoteStorage, Platform } from './platform/types';
```

- [ ] **Step 4: 執行整個 core 測試與型別檢查**

Run: `npm test -w @oc/core && npm run typecheck -w @oc/core`
Expected: `Test Files  18 passed (18)`、`Tests  87 passed (87)`；typecheck 無錯誤。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/index.test.ts
git commit -m "feat(core): export public API"
```

---

### Task 20: `apps/web` 骨架與 `selectPlatform`

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/test/setup.ts`
- Create: `apps/web/src/platform/selectPlatform.ts`
- Test: `apps/web/src/platform/selectPlatform.test.ts`

- [ ] **Step 1: 建立套件設定並安裝**

`apps/web/package.json`：

```json
{
  "name": "@oc/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@oc/core": "*",
    "react": "^19.3.1",
    "react-dom": "^19.3.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.64.1",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^5.2.0",
    "fake-indexeddb": "^6.2.6",
    "jsdom": "^26.1.0",
    "vite": "^7.3.7"
  }
}
```

`apps/web/tsconfig.json`（`e2e` 與設定檔也納入型別檢查）：

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "e2e", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

`apps/web/vite.config.ts`：

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: {
    // main.tsx uses top-level await.
    target: 'es2022',
    // Tiptap + React form one ~650 kB chunk; that is expected for this app.
    chunkSizeWarningLimit: 1000,
  },
});
```

`apps/web/vitest.config.ts`（只收 `src/**/*.test.*`，避免 Vitest 誤跑 Playwright 的 `e2e/*.spec.ts`）：

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // e2e/*.spec.ts belong to Playwright, not Vitest.
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

`apps/web/src/test/setup.ts`：

```ts
import 'fake-indexeddb/auto';
```

`apps/web/index.html`：

```html
<!doctype html>
<html lang="zh-Hant-TW">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#c026d3" />
    <title>open-copilot</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Run: `npm install`
Expected: 成功；`node_modules/@oc/web` 連到 `apps/web`。

- [ ] **Step 2: 寫失敗的測試**

`apps/web/src/platform/selectPlatform.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { selectPlatform } from './selectPlatform';

describe('selectPlatform (web)', () => {
  it('returns an IndexedDB-backed platform that can print', async () => {
    const platform = await selectPlatform();
    expect(platform.canPrint).toBe(true);
    expect(typeof platform.fileSaver.save).toBe('function');

    await platform.storage.put({
      id: 'n1',
      title: '測試',
      content: { type: 'doc' },
      createdAt: 1,
      updatedAt: 1,
    });
    expect(await platform.storage.list()).toEqual([
      expect.objectContaining({ id: 'n1', title: '測試' }),
    ]);
  });
});
```

- [ ] **Step 3: 執行測試，確認失敗**

Run: `npm test -w @oc/web`
Expected: FAIL，`Failed to resolve import "./selectPlatform" from "src/platform/selectPlatform.test.ts". Does the file exist?`

- [ ] **Step 4: 實作**

`apps/web/src/platform/selectPlatform.ts`：

```ts
import {
  createBrowserFileSaver,
  createIndexedDbStorage,
  openAppDb,
  type Platform,
} from '@oc/core';

/** M1: the browser platform only. M4 adds Electron, M5 adds Capacitor. */
export async function selectPlatform(): Promise<Platform> {
  const db = await openAppDb();
  return {
    storage: createIndexedDbStorage(db),
    fileSaver: createBrowserFileSaver(),
    canPrint: true,
  };
}
```

- [ ] **Step 5: 執行測試，確認通過**

Run: `npm test -w @oc/web`
Expected: `Tests  1 passed (1)`

- [ ] **Step 6: Commit**

```bash
git add apps/web package-lock.json
git commit -m "feat(web): scaffold web app and select browser platform"
```

---

### Task 21: 網頁入口 `main.tsx` 與 Playwright 端對端測試

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/src/main.tsx`
- Test: `apps/web/e2e/notes.spec.ts`

- [ ] **Step 1: 安裝 Playwright 的 Chromium**

Run: `npm exec -w @oc/web -- playwright install chromium`
Expected: 下載並安裝與 `@playwright/test` 版本對應的 Chromium（第一次需要網路，之後會快取在 `%LOCALAPPDATA%\ms-playwright`）。

- [ ] **Step 2: 建立 Playwright 設定**

`apps/web/playwright.config.ts`：

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Used by the M3b recording e2e; harmless for M1.
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 3: 寫失敗的端對端測試**

`apps/web/e2e/notes.spec.ts`：

```ts
import { expect, test, type Page } from '@playwright/test';

interface SavedNote {
  id: string;
  title: string;
  content: unknown;
  updatedAt: number;
}

/** Reads what the app has persisted in IndexedDB (database "open-copilot", store "notes"). */
function savedNotes(page: Page): Promise<SavedNote[]> {
  return page.evaluate(
    () =>
      new Promise<SavedNote[]>((resolve, reject) => {
        const open = indexedDB.open('open-copilot');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('notes', 'readonly').objectStore('notes').getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(request.result as SavedNote[]);
          };
        };
      }),
  );
}

/** Title + whether the body JSON contains `text`, newest first. */
async function savedSummary(page: Page, text: string) {
  const notes = await savedNotes(page);
  return notes
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((n) => ({ title: n.title, hasText: JSON.stringify(n.content).includes(text) }));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: '標題' })).toBeVisible();
});

test('新增筆記、輸入標題與內文，重新整理後內容仍在', async ({ page }) => {
  const list = page.getByRole('list', { name: '筆記清單' });
  const title = page.getByRole('textbox', { name: '標題' });
  const body = page.getByRole('textbox', { name: '筆記內文' });

  await page.getByRole('button', { name: '新增筆記' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);

  await title.fill('第一篇筆記');
  await body.click();
  await page.keyboard.type('這是內文');
  await expect(list.getByRole('button', { name: /^第一篇筆記/ })).toBeVisible();

  // Wait for the 500ms debounced save to reach IndexedDB before reloading.
  await expect
    .poll(() => savedSummary(page, '這是內文'))
    .toEqual([
      { title: '第一篇筆記', hasText: true },
      { title: '', hasText: false },
    ]);

  await page.reload();
  await expect(title).toHaveValue('第一篇筆記');
  await expect(body).toContainText('這是內文');
  await expect(list.getByRole('listitem')).toHaveCount(2);
});

test('輸入後立刻重新整理，最後的輸入也不會遺失', async ({ page }) => {
  // No waiting for the 500ms debounce: the pagehide flush must persist the edit.
  await page.getByRole('textbox', { name: '標題' }).fill('立刻重整');
  await page.reload();
  await expect(page.getByRole('textbox', { name: '標題' })).toHaveValue('立刻重整');
});

test('切換筆記與刪除筆記', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  const list = page.getByRole('list', { name: '筆記清單' });
  const title = page.getByRole('textbox', { name: '標題' });
  const body = page.getByRole('textbox', { name: '筆記內文' });

  await title.fill('筆記 A');
  await body.click();
  await page.keyboard.type('內容 A');

  await page.getByRole('button', { name: '新增筆記' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(title).toHaveValue('');
  await title.fill('筆記 B');
  await body.click();
  await page.keyboard.type('內容 B');

  await list.getByRole('button', { name: /^筆記 A/ }).click();
  await expect(title).toHaveValue('筆記 A');
  await expect(body).toContainText('內容 A');

  await list.getByRole('button', { name: /^筆記 B/ }).click();
  await expect(title).toHaveValue('筆記 B');
  await expect(body).toContainText('內容 B');

  await list.getByRole('button', { name: '刪除「筆記 A」' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).not.toContainText('筆記 A');

  await expect.poll(() => savedSummary(page, '內容 B')).toEqual([{ title: '筆記 B', hasText: true }]);
  await page.reload();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(title).toHaveValue('筆記 B');
});

test('窄螢幕時筆記清單收成抽屜', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const list = page.getByRole('list', { name: '筆記清單' });

  await expect(list).toBeHidden();

  // The palette popover must stay inside the viewport; 灰色 is its right-most swatch.
  await page.getByRole('button', { name: '螢光筆', exact: true }).click();
  const box = await page.getByRole('group', { name: '螢光筆色盤' }).boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: '灰色' }).click();
  await expect(page.getByRole('group', { name: '螢光筆色盤' })).toBeHidden();

  await page.getByRole('button', { name: '開啟筆記清單' }).click();
  await expect(list).toBeVisible();

  await page.getByRole('button', { name: '新增筆記' }).click();
  await expect(list).toBeHidden();

  await page.getByRole('button', { name: '開啟筆記清單' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
});
```

存檔有 500ms debounce，所以多數測試在重新整理前用 `expect.poll` 直接讀 IndexedDB，等寫入完成，不使用固定的 `waitForTimeout`；「立刻重新整理」那個測試則刻意不等，驗證 `pagehide` flush 加上 Task 6 的明確 commit 能保住最後一次輸入。每個 Playwright 測試都是全新的 browser context，IndexedDB 互不干擾。

- [ ] **Step 4: 執行，確認失敗**

Run: `npm run e2e`
Expected: 4 個測試都 FAIL，`expect(locator).toBeVisible() failed` / `element(s) not found` / `waiting for getByRole('textbox', { name: '標題' })`——因為 `index.html` 引用的 `/src/main.tsx` 還不存在，頁面是空白的。

- [ ] **Step 5: 實作入口**

`apps/web/src/main.tsx`：

```tsx
import { NotesApp, PlatformProvider } from '@oc/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { selectPlatform } from './platform/selectPlatform';

const platform = await selectPlatform();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <PlatformProvider platform={platform}>
      <NotesApp />
    </PlatformProvider>
  </StrictMode>,
);
```

- [ ] **Step 6: 執行，確認通過**

Run: `npm run e2e`
Expected: `4 passed`（第一次啟動 Vite 會預先打包依賴，單一測試可能需要 10–20 秒；之後約 3 秒）。

- [ ] **Step 7: 型別檢查與正式建置**

Run: `npm run typecheck -w @oc/web && npm run build -w @oc/web`
Expected: typecheck 無錯誤；`vite build` 輸出 `dist/index.html`、`dist/assets/index-*.css`、`dist/assets/index-*.js`（約 650 kB，gzip 約 210 kB）與 `✓ built in`。

- [ ] **Step 8: Commit**

```bash
git add apps/web/playwright.config.ts apps/web/e2e/notes.spec.ts apps/web/src/main.tsx
git commit -m "feat(web): mount NotesApp and add Playwright e2e for notes"
```

---

### Task 22: 網頁部署說明 `apps/web/README.md`

**Files:**
- Create: `apps/web/README.md`

spec §10 要求網頁以靜態檔部署到 Vercel 或 Cloudflare Pages。M3a 只寫後端的 Docker 部署，M4／M5 只處理安裝檔與 Android，所以網頁部署由本 Task 負責：寫一份部署者照做即可上線的 `apps/web/README.md`，並用實際建置驗證文件裡的指令與產物路徑。重點有三：產物必須放在網域根目錄（Vite `base` 維持 `/`，M4／M5 也依賴這點）、必須是 HTTPS（`crypto.randomUUID()` 與麥克風只在安全環境可用）、正式網域要加進 M3a 後端的 `ALLOWED_ORIGINS`（而且設定後會**取代**預設清單，必須連預設值一起寫）。本 Task 不改任何程式碼。

- [ ] **Step 1: 寫失敗的文件檢查**

Run:

```bash
for s in 'npm run build -w @oc/web' 'apps/web/dist' 'es2022' 'NODE_VERSION' 'ALLOWED_ORIGINS=https://notes.example.com,http://localhost:5173,https://localhost,capacitor://localhost,app://bundle'; do grep -qF -- "$s" apps/web/README.md 2>/dev/null && echo "ok: $s" || echo "MISSING: $s"; done
```

Expected: FAIL，5 行都是 `MISSING: ...`，因為 `apps/web/README.md` 還不存在。

- [ ] **Step 2: 建立 `apps/web/README.md`**

`apps/web/README.md`：

````markdown
# @oc/web

open-copilot 的網頁入口（Vite + React）。所有畫面與邏輯都在 `packages/core`（`@oc/core`）；這裡只負責選擇平台（`src/platform/selectPlatform.ts`）並掛載 `<NotesApp />`。

## 本機開發

以下指令都在 repo 根目錄以 Git Bash 執行。

| 指令 | 用途 |
|---|---|
| `npm install` | 安裝所有 workspace 的依賴 |
| `npm run dev -w @oc/web` | 開發伺服器 `http://localhost:5173` |
| `npm test -w @oc/web` | 單元測試（Vitest） |
| `npm run typecheck -w @oc/web` | 型別檢查 |
| `npm run e2e -w @oc/web` | 端對端測試（Playwright；第一次先執行 `npm exec -w @oc/web -- playwright install chromium`） |
| `npm run build -w @oc/web` | 正式建置，輸出到 `apps/web/dist` |
| `npm run preview -w @oc/web` | 以靜態伺服器提供 `apps/web/dist`，網址 `http://localhost:4173` |

## 建置產物

`npm run build -w @oc/web` 只產生靜態檔，部署時上傳整個 `apps/web/dist`：

- `index.html`
- `assets/index-<hash>.js`、`assets/index-<hash>.css`（之後的里程碑會多出按需載入的 `assets/*-<hash>.js` 分塊）

建置不需要任何環境變數。後端網址與存取金鑰（M3 起）由使用者在 App 的「設定」輸入，存在該瀏覽器的 localStorage，不會寫進建置產物。

## 部署限制

- **必須放在網域根目錄**（例如 `https://notes.example.com/`），不可放在子路徑（例如 `https://example.com/notes/`）。Vite `base` 維持預設 `/`，`index.html` 以 `/assets/...` 絕對路徑載入程式；桌面版（Electron）與 Android（Capacitor）也共用同一份建置產物，不要為了子路徑修改 `base`。
- **必須是 HTTPS**。建立筆記用的 `crypto.randomUUID()` 與錄音用的麥克風只在安全環境（HTTPS 或 `localhost`）可用；用 `http://<區網 IP>` 開啟會無法建立筆記。Vercel 與 Cloudflare Pages 預設就是 HTTPS。
- **瀏覽器需支援 ES2022**。`src/main.tsx` 使用頂層 `await`，`vite.config.ts` 的 `build.target` 是 `es2022`，至少需要 Chrome／Edge 89、Firefox 89、Safari 15（iOS 15）；更舊的瀏覽器會停在空白頁，Console 顯示語法錯誤。
- **沒有前端路由**。整個 App 只有 `/` 一頁，不需要設定 SPA rewrite：Cloudflare Pages 在產物沒有 `404.html` 時會把未知路徑回成 `index.html`；Vercel 對未知路徑回 404，兩者都不影響使用。日後若加入前端路由，Vercel 要另外設定把所有路徑 rewrite 到 `/index.html`。
- **筆記只存在使用者的瀏覽器**（IndexedDB，依網域區分）。換網域或改用預覽網址開啟，會看到另一份筆記；清除網站資料會刪除筆記。正式環境請固定一個網域（建議綁自訂網域）。

## 部署到 Vercel

1. 把 repo 推到 Vercel 支援的 Git 服務（GitHub／GitLab／Bitbucket），在 Vercel 新增 Project 並匯入這個 repo。
2. Project 設定：

   | 欄位 | 值 |
   |---|---|
   | Root Directory | 留空（repo 根目錄；npm workspaces 必須從根目錄安裝） |
   | Framework Preset | `Other` |
   | Install Command | `npm ci` |
   | Build Command | `npm run build -w @oc/web` |
   | Output Directory | `apps/web/dist` |
   | Node.js Version（專案 Settings） | `24.x` |

3. 部署完成後，正式網址是 `https://<專案名稱>.vercel.app`；自訂網域在專案 Settings 的 Domains 加入。

## 部署到 Cloudflare Pages

1. 在 Cloudflare 主控台的 Workers & Pages 建立 Pages 專案，連接這個 repo 的 Git 服務。
2. 建置設定：

   | 欄位 | 值 |
   |---|---|
   | Framework preset | `None` |
   | Build command | `npm run build -w @oc/web` |
   | Build output directory | `apps/web/dist` |
   | Root directory（進階） | 留空（repo 根目錄） |
   | 環境變數 | `NODE_VERSION` = `24` |

   Pages 偵測到根目錄的 `package-lock.json` 會自動安裝依賴，不需另設安裝指令。
3. 正式網址是 `https://<專案名稱>.pages.dev`；自訂網域在專案的 Custom domains 加入。

沒有 Git 遠端時，可改用 Pages 的 Direct Upload：在本機執行 `npm run build -w @oc/web`，把 `apps/web/dist` 資料夾上傳；之後每次更新都要重新建置再上傳（Direct Upload 專案之後不能改成連接 Git，要改需另建專案）。

## 兩個平台共通

- Node 用 24（與開發機相同；Vite 7 最低需要 20.19 或 22.12）。
- M4 起，根目錄安裝依賴時也會安裝 `@oc/desktop` 的 `electron`，它會額外下載約 100 MB 的 Electron 執行檔。網頁建置用不到它，可在部署平台加上環境變數 `ELECTRON_SKIP_BINARY_DOWNLOAD` = `1` 跳過下載。

## 連接後端（M3 起）

網頁版錄音會呼叫 M3 的後端（`apps/api`，部署方式見 `apps/api/README.md`）。後端以 CORS 白名單限制來源，**正式網頁的來源必須加進後端的 `ALLOWED_ORIGINS`**，否則瀏覽器會擋下請求：設定頁的「測試連線」顯示「連線失敗，請確認後端網址」，錄音的每一段都變成「⚠ 第 N 段未轉寫・重試」。

- 來源是「協定 + 網域（+ 非預設埠）」，不含路徑與結尾斜線：寫 `https://notes.example.com`，不是 `https://notes.example.com/`。
- 設定 `ALLOWED_ORIGINS` 會**取代**預設清單，所以要把預設值一起寫上，否則本機開發（`http://localhost:5173`）、Android（`https://localhost`）、iOS（`capacitor://localhost`）與桌面版（`app://bundle`）都會被擋：

  ```
  ALLOWED_ORIGINS=https://notes.example.com,http://localhost:5173,https://localhost,capacitor://localhost,app://bundle
  ```

- 預覽部署（Vercel 每次預覽部署的 `*.vercel.app` 網址、Cloudflare Pages 的 `<hash>.<專案名稱>.pages.dev`）是不同的來源；要在預覽網址測錄音，就把該網址也加進 `ALLOWED_ORIGINS`。
- 正式環境的後端必須是 HTTPS：HTTPS 頁面呼叫 `http://` 後端會被瀏覽器當成混合內容擋下。
- 改完環境變數要重新啟動（或重新部署）後端才會生效。

確認白名單（把兩個網址換成自己的）：

```bash
curl -s -i https://api.example.com/health -H 'Origin: https://notes.example.com' | grep -i '^access-control-allow-origin'
```

應輸出 `access-control-allow-origin: https://notes.example.com`；沒有輸出表示這個來源不在白名單內。

## 部署後檢查

用 Chrome 開正式網址，逐項確認：

- [ ] 網址列是 `https://`；畫面出現一篇「未命名筆記」，標題框顯示「請輸入標題..」，內文顯示「在這裡開始編寫筆記..」。
- [ ] DevTools → Network（勾選 Disable cache 後重新整理）：文件本身與 `/assets/index-*.js`、`/assets/index-*.css` 都是 200。
- [ ] 輸入標題與內文，等一秒後重新整理，內容仍在。
- [ ] DevTools Console 沒有錯誤。
- [ ] （M3 起）「設定」填入後端網址與存取金鑰，按「測試連線」顯示「連線成功」；按「錄製」說幾句話再停止，文字插入筆記。
````

- [ ] **Step 3: 執行文件檢查，確認通過**

Run:

```bash
for s in 'npm run build -w @oc/web' 'apps/web/dist' 'es2022' 'NODE_VERSION' 'ALLOWED_ORIGINS=https://notes.example.com,http://localhost:5173,https://localhost,capacitor://localhost,app://bundle'; do grep -qF -- "$s" apps/web/README.md 2>/dev/null && echo "ok: $s" || echo "MISSING: $s"; done
```

Expected: PASS，5 行都是 `ok: ...`，沒有 `MISSING`。最後一項與契約 §4 後端（M3a）的 `ALLOWED_ORIGINS` 預設值逐字一致，只在最前面多了正式網域。

- [ ] **Step 4: 確認文件描述的建置產物與實際一致**

Run: `npm run build -w @oc/web && ls apps/web/dist && grep -o 'src="/assets/index-[^"]*\.js"' apps/web/dist/index.html`
Expected: `✓ built in`；`ls` 只列出 `assets` 與 `index.html`；grep 輸出一行 `src="/assets/index-<hash>.js"`（以 `/assets/` 開頭的絕對路徑，對應 README「必須放在網域根目錄」）。

- [ ] **Step 5: 以靜態伺服器提供產物（模擬部署）**

Run: `npm run preview -w @oc/web`
Expected: 輸出 `➜  Local:   http://localhost:4173/`（若 4173 被占用會直接報錯，先關掉占用的程式）。用 Chrome 開 `http://localhost:4173`：出現一篇「未命名筆記」、標題框顯示「請輸入標題..」；輸入標題，等一秒後重新整理，標題仍在；DevTools Console 沒有錯誤。確認後在終端機按 Ctrl+C 結束。

- [ ] **Step 6: Commit**

```bash
git add apps/web/README.md
git commit -m "docs(web): add build and static deployment guide"
```

---

### Task 23: Verification（整體驗證）

**Files:** 無新增或修改。

- [ ] **Step 1: 全部單元與元件測試**

Run: `npm test`
Expected:
- `@oc/core`：`Test Files  18 passed (18)`、`Tests  87 passed (87)`
- `@oc/shared`：`Test Files  1 passed (1)`、`Tests  3 passed (3)`
- `@oc/web`：`Test Files  1 passed (1)`、`Tests  1 passed (1)`

輸出中不應出現 `stderr`、`not wrapped in act(...)` 或 `Unhandled Errors`。

- [ ] **Step 2: 全部型別檢查**

Run: `npm run typecheck`
Expected: `@oc/core`、`@oc/shared`、`@oc/web` 三個 `tsc --noEmit` 皆無錯誤輸出。

- [ ] **Step 3: 端對端測試（重複 3 次確認穩定）**

Run: `npm run e2e -w @oc/web -- --repeat-each=3`
Expected: `12 passed`

- [ ] **Step 4: 正式建置**

Run: `npm run build -w @oc/web && grep -o 'src="/assets/index-[^"]*\.js"' apps/web/dist/index.html`
Expected: `✓ built in`，沒有錯誤；最後一行是 `src="/assets/index-<hash>.js"`（產物在 `apps/web/dist`，以網域根目錄的絕對路徑載入，與 `apps/web/README.md` 一致）。

- [ ] **Step 5: 手動檢查表**

Run: `npm run dev -w @oc/web`，用 Chrome 開 `http://localhost:5173`，逐項確認：

- [ ] 第一次開啟自動有一篇「未命名筆記」；標題框顯示「請輸入標題..」，內文顯示「在這裡開始編寫筆記..」。
- [ ] 用注音輸入標題，選字時按 Enter 不會跳到內文；選完字再按 Enter，游標移到內文開頭。
- [ ] 標題一變，左側清單同步更新；編輯的筆記移到清單最上方。
- [ ] 工具列：段落樣式（正文／標題 1／標題 2／標題 3）、粗體／斜體／底線、字色 8 色 + 清除、螢光筆 8 色 + 清除、靠左／置中／靠右、項目清單、編號清單皆可用，按鈕亮起狀態（`#c026d3` 圓形底色）與游標所在文字一致。
- [ ] 復原／重做可用，沒有歷史時呈灰色；切換到另一篇筆記後無法「復原」回上一篇的內容。
- [ ] 在 A 篇套用項目清單後切到開頭是「標題 1」的 B 篇：不必點內文，段落樣式立即顯示「標題 1」、項目清單鈕不再亮起。
- [ ] 調色盤開啟時，按 Esc 或點外面會關閉。
- [ ] 輸入後立刻重新整理（F5）：最後 500ms 內的輸入也還在（`pagehide` 會 flush）。
- [ ] 新增、切換、刪除筆記；刪除時跳出「確定要刪除「…」嗎？此動作無法復原。」，按取消不刪；刪掉最後一篇會自動建立一篇新的空白筆記。
- [ ] 「錄製」鈕為停用狀態，滑鼠移上去顯示「即將推出」；AI 摘要／待辦事項／AI 助理／AI 對話四顆鈕有鎖頭圖示且無法點擊。
- [ ] 橫幅文字為「**手動輸入累了？** 按「錄製」，open-copilot 幫你把語音轉成文字，你只需要專注思考。」，畫面上沒有任何他牌名稱。
- [ ] 用 DevTools 裝置模式把寬度調到 < 768px：左側清單消失、出現 ☰ 選單鈕；點選單鈕抽屜滑出、點背景或選一篇筆記後收回。
- [ ] 同樣在 < 768px（試 320px 與 390px）：字色與螢光筆調色盤完整顯示在畫面內、出現在工具列下方，8 個色塊與「清除」都點得到。
- [ ] DevTools → Application → IndexedDB → `open-copilot` 有 `notes` 與 `pendingSegments` 兩個 store，`notes` 內容與畫面一致。
- [ ] DevTools Console 沒有錯誤或警告。

- [ ] **Step 6: 靜態預覽（模擬部署）**

Run: `npm run preview -w @oc/web`（使用 Step 4 的建置產物）
Expected: 輸出 `➜  Local:   http://localhost:4173/`。用 Chrome 開 `http://localhost:4173`，逐項確認後按 Ctrl+C 結束：

- [ ] 出現一篇「未命名筆記」，標題框顯示「請輸入標題..」。
- [ ] DevTools → Network（勾選 Disable cache 後重新整理）：文件本身與 `/assets/index-*.js`、`/assets/index-*.css` 都是 200。
- [ ] 輸入標題與內文，重新整理後仍在。
- [ ] DevTools Console 沒有錯誤。

- [ ] **Step 7: 正式部署後檢查（需要部署者的 Vercel 或 Cloudflare Pages 帳號）**

由擁有帳號的人依 `apps/web/README.md` 的「部署到 Vercel」或「部署到 Cloudflare Pages」部署，再用 Chrome 開正式網址，逐項完成 README「部署後檢查」的前四項（M3 項目留待 M3b 驗證）：

- [ ] 網址列是 `https://`；畫面出現一篇「未命名筆記」，標題框顯示「請輸入標題..」，內文顯示「在這裡開始編寫筆記..」。
- [ ] DevTools → Network：文件本身與 `/assets/index-*.js`、`/assets/index-*.css` 都是 200。
- [ ] 輸入標題與內文，等一秒後重新整理，內容仍在。
- [ ] DevTools Console 沒有錯誤。

執行計畫的代理不得自行建立帳號或登入部署平台。沒有可用的部署時，不得勾選本步；在回報中寫明「網頁正式部署：未驗證（無部署帳號）」，Step 6 的靜態預覽結果照常回報。

- [ ] **Step 8: 確認給 M3a 的根設定格式**

Run: `grep -n '"workspaces"' package.json`
Expected: 只有一行 `5:  "workspaces": ["packages/*", "apps/*"],`（單行陣列；M3a 的前置檢查依賴這個格式）。

- [ ] **Step 9: 確認工作目錄乾淨**

Run: `git status --short -- . ':(exclude)docs/superpowers/plans'`
Expected: 沒有輸出（`dist/`、`playwright-report/`、`test-results/` 已被 `.gitignore` 忽略；計畫檔因勾選 checkbox 而變動是允許的，故排除）。
