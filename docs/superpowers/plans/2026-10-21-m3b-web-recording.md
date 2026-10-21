# M3b 網頁版錄音（設定、切段、上傳、重試、依序插入）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用者在網頁版按「錄製」後，麥克風語音每 4–8 秒切成一段上傳到 M3a 的 `POST /transcribe`，轉寫文字依錄音順序插入按下錄製時的游標位置；重試仍失敗的片段變成可點擊重送的「⚠ 第 N 段未轉寫・重試」標記，並提供後端網址／存取金鑰的設定頁。

**Architecture:** 純邏輯拆成可單獨測試的小模組（`settingsStore`、`apiClient`、`SegmentPolicy`、`SegmentRecorder`、`OrderedBuffer`、`withRetry`、`TranscriptInserter`、`replaceGap`、`pendingQueue`），由 `useRecorder` hook 組裝：每段錄音重開一個 `MediaRecorder`，各段並行上傳，結果經 `OrderedBuffer` 依 `seq` 釋出，再由 `TranscriptInserter`（以 Tiptap transaction mapping 追蹤插入點）寫入編輯器；重試仍失敗的音訊存進 IndexedDB `pendingSegments`。`NotesApp` 只負責接線：設定對話框、錄製鈕四種狀態、錯誤／提示列、錄音中鎖住筆記清單、點擊標記重送；`Platform` 介面不變，錄音佇列使用同名資料庫的第二個連線。

**Tech Stack:** TypeScript 5.9、React 19、Tiptap v3（自訂 inline atom Node）、idb 8、標準 `MediaRecorder`／`AudioContext`／`fetch`、lucide-react 1.x、Vitest 3 + jsdom 26 + Testing Library + fake-indexeddb、Playwright（Chromium 假麥克風 + `page.route` 模擬後端）。

---

## 前置條件

- 在 repo 根目錄 `D:\git\open-copilot` 以 **Git Bash** 執行所有指令。Node 24、npm 11。
- M1（`2026-10-21-m1-web-editor.md`）與 M2（`2026-10-21-m2-export-copy.md`）已全部完成並 commit；本計畫的「修改」步驟以這兩份計畫產出的檔案內容為準。
- M3a（`2026-10-21-m3a-transcribe-api.md`）已完成。本計畫的程式碼不 import `apps/api`（自動化測試全部用假的 fetch／`page.route`），但 Verification 的人工檢查會在本機啟動 M3a 的後端。
- 本計畫不新增任何套件（執行期或開發期），只用 M1／M2 已安裝的依賴。
- 本計畫的程式碼已在本機以 M1＋M2 計畫的實際產出為基礎完整跑過：每個 Task 的「先失敗、後通過」、三個 workspace 的 typecheck、`vite build`、Playwright e2e（`--repeat-each=3`）。版本與 M2 相同：@tiptap/* 3.32.0、vitest 3.2.7、jsdom 26.1.0、fake-indexeddb 6.2.6、lucide-react 1.61.0、@playwright/test 1.64.1。審閱後修訂的部分（`pendingQueue.removeByNote` 與 `NotesApp` 刪除筆記時呼叫它、`start()` 在權限詢問後重新確認筆記、`retryGap` 綁定點擊當下的 editor、e2e 停止前多等 1.5 秒）尚未重新實跑，相關測試數字是依新增的測試推算；執行時若數字不符，以實際輸出為準並回報。

- [ ] **前置步驟 1：確認 M1、M2、M3a 已完成**

Run: `npm test -w @oc/core`
Expected: `Test Files  29 passed (29)`、`Tests  176 passed (176)`。

Run: `ls packages/core/src/editor/NoteActions.tsx packages/core/src/export/common.ts apps/web/e2e/export.spec.ts apps/api/src/app.ts`
Expected: 四個檔案都列出，沒有 `No such file or directory`。

- [ ] **前置步驟 2：commit 計畫文件**

Run: `git status --short`
Expected: 沒有輸出，或只有 `docs/superpowers/plans/` 底下的變動（例如本計畫檔 `?? docs/superpowers/plans/2026-10-21-m3b-web-recording.md`，或勾選 checkbox 造成的修改）。若出現其他路徑，先停下來回報。

若有 `docs/superpowers/plans/` 的變動：

```bash
git add docs/superpowers/plans
git commit -m "docs: add M3b web recording plan"
```

Run: `git status --short`
Expected: 沒有輸出。

## 與共用契約的關係（下游計畫必讀）

本計畫遵守 `2026-10-21-00-overview.md` 的 M3b 簽章；下表是契約沒有寫死、由本計畫決定（或以「只增不減」方式擴充）的細節，M4／M5 撰寫時請以此為準：

| 項目 | 決定 |
|---|---|
| `Settings` 儲存 | localStorage `oc.settings`。`saveSettings` 會 trim 兩個欄位並去掉網址結尾的 `/`；讀到壞掉或缺欄位的 JSON 一律當空字串。`isConfigured` 要求網址與金鑰都非空白。Electron 與 Capacitor 的 WebView 都有 localStorage，不需要轉接層。另匯出 `EMPTY_SETTINGS`、`normalizeSettings`、`isValidBaseUrl`（只接受 `http:`／`https:`）。 |
| `useSettings` | `useSettings(): { settings: Settings; saveSettings(next: Settings): void }`。 |
| `SettingsDialog` | `SettingsDialog({ settings, onSave(next), onClose(), checkHealth? })`，只在開啟時渲染（`{settingsOpen && <SettingsDialog … />}`），所以每次開啟都從目前設定重新填值。`role="dialog"`、`aria-modal="true"`、標題「設定」；欄位 label「後端網址」「存取金鑰」（password）；按鈕「測試連線」「取消」「儲存」；訊息「測試中…」「連線成功」「連線失敗，請確認後端網址」「請輸入 http:// 或 https:// 開頭的網址」；提示「存取金鑰只會儲存在這台裝置上。」。`onSave` 收到正規化後的設定，由 `NotesApp` 存檔並關閉。`checkHealth` 預設為 `createApiClient({ baseUrl }).health()`。 |
| `ApiError` | 契約欄位之外多一個選用的 `code?: ApiErrorCode`（後端 JSON 的 `error`）。錯誤 body 不是 JSON（代理伺服器的 HTML 錯誤頁）時照樣以 status 建立，符合 M3a 的要求。200 但 body 不是 `{ seq, text }` 時丟 `ApiError('Invalid transcribe response', 200)`（不重試，變成未轉寫標記；通常是網址指到別的網站）。 |
| `createApiClient` | 契約參數之外多一個選用的 `timeoutMs`（預設 `REQUEST_TIMEOUT_MS = 30_000`），逾時以 `AbortController` 中止並視同網路錯誤（status 0，會重試），避免一個卡住的請求讓後面所有片段永遠等不到順序。`fetchImpl` 預設在**呼叫當下**才讀全域 `fetch`，測試可用 `vi.stubGlobal('fetch', …)`。`health()` 不帶金鑰（M3a 的 `/health` 不驗證），任何錯誤都回 `false`。 |
| `SegmentPolicy` | 契約寫的 `minMs?: 4000` 等是預設值，實際型別為 `number`。停頓從第一個低於門檻的讀數開始計時，所以 4 秒前就開始的停頓在第 4 秒即可切段。 |
| `SegmentRecorder` | `seq` 在段落**交付**時才編號：沒有任何資料的段落直接略過、不佔號，`OrderedBuffer` 不會卡住。另匯出 `RecordedSegment`、`SegmentRecorderOptions` 型別。建立 `AudioContext` 失敗（或環境沒有）時每次讀數都視為說話，退回 8 秒固定切段。它不會停止 stream 的 track（由 `useRecorder` 停）。 |
| `useRecorder` 選項 | 契約的 `{ editor, noteId, settings, db }` 之外：`noteId` 可為 `undefined`（筆記載入中，此時 `start()` 不動作）；`db` 可傳 `openAppDb()` 回傳的 promise（型別 `AppDbHandle`，`createPendingQueue` 同樣接受）；選用 `onUnauthorized()`（401 時通知 `NotesApp` 開設定頁）；選用 `deps: Partial<RecorderDeps>`（測試替換 getUserMedia、SegmentRecorder、ApiClient、pickMimeType、sleep、gapId 產生器）。 |
| `start()` 與權限詢問 | 瀏覽器的麥克風權限泡泡不會擋住頁面，詢問期間階段仍是 `idle`、筆記清單可用。`getUserMedia` 回來後重新讀一次選項：`noteId` 或 `editor` 已換掉、editor 已銷毀、或設定已不完整時，立刻停止剛拿到的 track、維持 `idle`、不顯示訊息（使用者已在別篇筆記，再按一次「錄製」即可）。`ApiClient` 用這時讀到的設定建立。 |
| `useRecorder` 回傳 | 契約欄位之外多 `dismissMessages()`（錯誤／提示列的關閉鈕）。`state` 由內部階段推導：未設定時 `needsSetup`，錄音中 `recording`，按停止後到所有上傳結束為 `stopping`。設定值改變時自動清掉舊的錯誤訊息。 |
| `retryGap` 與切換筆記 | 重送期間階段仍是 `idle`，筆記清單可用，而一次重送最久可能超過 2 分鐘（1s→2s→4s 加上每次最多 30 秒逾時）。所以 `retryGap` 在**點擊當下**取 editor，回應回來後只在 `replaceGap` 真的取代了標記時才刪除記憶體與 IndexedDB 中的音訊。`replaceGap` 回傳 `false` 時一律保留音訊：editor 已銷毀（切到別篇或刪除了筆記）→ 顯示 `retryFailed`，回到原筆記再點一次即可；editor 還在但標記已被使用者刪除 → 不顯示訊息（復原可讓標記回來，音訊在該筆記被刪除時才清掉）。 |
| 錯誤分類 | 重試後仍失敗的網路錯誤（含逾時）、5xx、429、其他 4xx 與格式錯誤 → 未轉寫標記；401 → 停止錄音、`error = '存取金鑰錯誤，請重新設定'`、`onUnauthorized()`，**該段音訊也存成未轉寫標記**（換好金鑰後點擊即可補上，不會遺失）；400、413 → `console.warn` 後略過；空字串 → 略過。每種情況都會推進順序。 |
| 其他訊息 | `RECORDER_MESSAGES`：`startFailed = '無法開始錄音，請再試一次'`（`MediaRecorder` 無法啟動）、`retryFailed = '重新轉寫失敗，請稍後再試'`、`audioMissing = '找不到這段錄音，無法重新轉寫'`（記憶體與 IndexedDB 都沒有該段音訊）。 |
| 未轉寫標記 | Tiptap Node `TranscriptGap`（`editor/transcriptGap.ts`），`name` 直接用 M2 的 `TRANSCRIPT_GAP_TYPE`。`getHTML()` 與契約逐字相同：`<span class="oc-gap" data-transcript-gap="{gapId}">⚠ 第 {seq} 段未轉寫・重試</span>`；`seq` 不另寫成 HTML 屬性，解析 HTML 時從標籤文字讀回。`renderText` 回傳 `[未轉寫片段]`，與所有匯出器一致。重試入口：`NotesApp` 的 `.oc-document` 以 React `onClick` 事件委派找 `[data-transcript-gap]`，不需要 ProseMirror plugin。 |
| 插入點 | 按下「錄製」時的 `editor.state.selection.to`；若不在文字區塊內（例如全選），移到最近的文字位置。轉寫文字一律不帶 mark（游標在粗體裡也插入純文字），也不移動使用者的游標。 |
| `pendingQueue` | 契約的 `add`／`get`／`remove` 之外多 `removeByNote(noteId): Promise<void>`：在一個 readwrite 交易內 `getAll` 後刪除 `noteId` 相符的每一列（`pendingSegments` 沒有 `noteId` 索引，M1 的 DB 版本 1 不變）。`NotesApp` 在 `deleteNote(id)` 成功後呼叫，否則被刪筆記的標記永遠無法重送，音訊卻會一直留在本機（spec §1 第一版不保存原始音檔，§8 只允許為了重送而暫存）。 |
| 錄音佇列 DB | 依 M1 的建議：`NotesApp` 以 `useState(openRecorderDb)` 開同名 `'open-copilot'` 的第二個連線（不經 `Platform`）。React StrictMode 開發模式會多開一個不用的連線，無害。 |
| `ActionBar` | `ActionBar({ recordState, onRecord, onOpenSettings })`。錄製鈕 class `oc-record-btn`，文字依狀態為「錄製／請先設定／停止／處理中」（處理中 disabled、`aria-busy`；錄音中加 `is-recording`）。AI 鈕之後是齒輪鈕 `aria-label="設定"`。按鈕的實際動作由 `NotesApp` 決定。 |
| `NoteList` | 新增 `disabled?: boolean`：新增、切換、刪除鈕全部 disabled（錄音中與處理中）。 |
| 錯誤／提示列 | `NotesApp` 在 Banner 下方顯示 `role="alert"` 的 `.oc-recorder-alert`（錯誤紅字、提示褐字），附「關閉訊息」鈕。**不使用 `role="status"`**：M2 的 `NoteActions` 已佔用，既有測試以 `getByRole('status')` 取它。 |
| 中斷提示 | 頁面在背景時錄音被中斷 → 回到前景（`visibilitychange`）才顯示「錄音已中斷，已錄的部分會照常轉寫」；在前景被中斷（例如拔掉麥克風）則立即顯示。已錄的部分照常上傳、插入。 |
| 測試輔助 | `test/media.ts`（`FakeMediaRecorder`、`createFakeStream`、`createFakeAudioContext`）與 `test/recorderHarness.ts`（`setupRecorder`、`createTestEditor`、`FakeSegmentRecorder`、`createFakeClient`、`settle`、`CONFIGURED`）。M5 測試 Android 背景中斷時可沿用。 |
| jsdom 限制 | (1) jsdom 的 `Blob` 經 fake-indexeddb 的 structuredClone 會變成一般物件，所以 `pendingQueue` 測試改用 `node:buffer` 的 `Blob`；真實 Blob 能否存回，由 e2e「重新整理後點擊標記補上」在 Chromium 驗證。(2) jsdom 的 `FileReader` 在假計時器下不會觸發 load，假計時器測試只檢查 `blob.size`。(3) 點擊編輯器內的標記用 `fireEvent.click`：user-event 先送的 mousedown 會讓 ProseMirror 呼叫 jsdom 沒有的 `document.elementFromPoint`。(4) jsdom 不實作 `contentEditable` IDL 屬性，標記的 `contenteditable="false"` 只在真瀏覽器出現，測試不檢查。 |

## File Structure

| 檔案 | 動作 | 單一職責 |
|---|---|---|
| `packages/core/src/settings/settingsStore.ts` | Create | `Settings` 型別、localStorage 讀寫、正規化、`isConfigured`、`isValidBaseUrl` |
| `packages/core/src/settings/useSettings.ts` | Create | 設定的 React state 與存檔 |
| `packages/core/src/api/apiClient.ts` | Create | `ApiError`、`createApiClient`（`health`、`transcribe`、逾時）、`parseRetryAfter` |
| `packages/core/src/components/SettingsDialog.tsx` | Create | 設定對話框：後端網址、存取金鑰、測試連線 |
| `packages/core/src/recording/pickMimeType.ts` | Create | 選錄音格式、副檔名 |
| `packages/core/src/recording/rms.ts` | Create | `computeRms` |
| `packages/core/src/recording/segmentPolicy.ts` | Create | 何時切段（停頓／最長 8 秒） |
| `packages/core/src/test/media.ts` | Create | 測試替身：`MediaRecorder`、`MediaStream`、`AudioContext` |
| `packages/core/src/recording/segmentRecorder.ts` | Create | 每段一個 `MediaRecorder`、以音量切段、交付 `{ seq, blob }`、track 結束視為中斷 |
| `packages/core/src/recording/orderedBuffer.ts` | Create | 依 `seq` 重新排序結果 |
| `packages/core/src/recording/retry.ts` | Create | `withRetry`：1s→2s→4s、429 依 `Retry-After` |
| `packages/core/src/editor/transcriptGap.ts` | Create | Tiptap Node `TranscriptGap` 與 `gapLabel` |
| `packages/core/src/editor/extensions.ts` | Modify | 加入 `TranscriptGap` |
| `packages/core/src/recording/transcriptInserter.ts` | Create | 在追蹤中的插入點插入文字或標記 |
| `packages/core/src/recording/replaceGap.ts` | Create | 以文字取代（或移除）指定標記 |
| `packages/core/src/recording/pendingQueue.ts` | Create | `pendingSegments` store 的 add／get／remove／removeByNote |
| `packages/core/src/test/recorderHarness.ts` | Create | `useRecorder` 測試用的假錄音器、假 API、測試 editor、渲染輔助（可換 editor／noteId 模擬切換筆記） |
| `packages/core/src/recording/useRecorder.ts` | Create（Task 13）、Modify（Task 14） | 錄音流程：開始、上傳、重試、依序插入、停止、標記與重送、錯誤與提示 |
| `packages/core/src/components/ActionBar.tsx` | Modify | 錄製鈕四種狀態 + 齒輪鈕 |
| `packages/core/src/components/NoteList.tsx` | Modify | `disabled` |
| `packages/core/src/NotesApp.tsx` | Modify | 接上設定、錄音、錯誤／提示列、點擊標記重送、錄音中鎖清單、刪除筆記時清掉其未轉寫音訊 |
| `packages/core/src/styles/app.css` | Modify | 錄製鈕狀態、齒輪、提示列、未轉寫標記、設定對話框、清單停用樣式 |
| `packages/core/src/components/ActionBar.test.tsx` | Modify | 改測新的錄製鈕與齒輪 |
| `packages/core/src/components/NoteList.test.tsx` | Modify | 加測 `disabled` |
| `packages/core/src/NotesApp.test.tsx` | Modify | 「錄製」鈕斷言改為「請先設定」與齒輪 |
| `packages/core/src/NotesApp.recording.test.tsx` | Create | 設定流程、錄音整合、401 → 標記 → 點擊重送、麥克風被拒、刪除筆記清掉未轉寫音訊 |
| `apps/web/e2e/recording.spec.ts` | Create | 假麥克風 + 模擬後端的完整錄音流程 |

每個新的 `*.ts(x)` 旁邊的 `*.test.ts(x)` 為其測試（`useRecorder` 有兩個：`useRecorder.test.ts`、`useRecorder.failures.test.ts`）。

---

### Task 1: 設定儲存 `settingsStore` 與 `useSettings`

**Files:**
- Create: `packages/core/src/settings/settingsStore.ts`
- Create: `packages/core/src/settings/useSettings.ts`
- Test: `packages/core/src/settings/settingsStore.test.ts`
- Test: `packages/core/src/settings/useSettings.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/settings/settingsStore.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_SETTINGS,
  isConfigured,
  isValidBaseUrl,
  loadSettings,
  normalizeSettings,
  saveSettings,
  SETTINGS_KEY,
} from './settingsStore';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('loadSettings', () => {
  it('returns empty settings when nothing is stored', () => {
    expect(SETTINGS_KEY).toBe('oc.settings');
    expect(loadSettings()).toEqual(EMPTY_SETTINGS);
    expect(EMPTY_SETTINGS).toEqual({ apiBaseUrl: '', accessKey: '' });
  });

  it('reads what saveSettings wrote, trimmed and without a trailing slash', () => {
    saveSettings({ apiBaseUrl: ' https://api.example.com/ ', accessKey: ' key-1 ' });
    expect(JSON.parse(localStorage.getItem('oc.settings') ?? '')).toEqual({
      apiBaseUrl: 'https://api.example.com',
      accessKey: 'key-1',
    });
    expect(loadSettings()).toEqual({ apiBaseUrl: 'https://api.example.com', accessKey: 'key-1' });
  });

  it('ignores broken or partial JSON', () => {
    localStorage.setItem('oc.settings', '{not json');
    expect(loadSettings()).toEqual(EMPTY_SETTINGS);
    localStorage.setItem('oc.settings', JSON.stringify({ apiBaseUrl: 'https://a.test', accessKey: 42 }));
    expect(loadSettings()).toEqual({ apiBaseUrl: 'https://a.test', accessKey: '' });
    localStorage.setItem('oc.settings', 'null');
    expect(loadSettings()).toEqual(EMPTY_SETTINGS);
  });
});

describe('saveSettings', () => {
  it('does not throw when storage is unavailable', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => saveSettings({ apiBaseUrl: 'https://a.test', accessKey: 'k' })).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('normalizeSettings', () => {
  it('trims both fields and drops trailing slashes from the URL', () => {
    expect(normalizeSettings({ apiBaseUrl: ' http://localhost:8787// ', accessKey: '\tk\n' })).toEqual({
      apiBaseUrl: 'http://localhost:8787',
      accessKey: 'k',
    });
  });
});

describe('isConfigured', () => {
  it('needs both a backend URL and an access key', () => {
    expect(isConfigured({ apiBaseUrl: 'https://a.test', accessKey: 'k' })).toBe(true);
    expect(isConfigured({ apiBaseUrl: 'https://a.test', accessKey: ' ' })).toBe(false);
    expect(isConfigured({ apiBaseUrl: '', accessKey: 'k' })).toBe(false);
  });
});

describe('isValidBaseUrl', () => {
  it('accepts only http and https URLs', () => {
    expect(isValidBaseUrl('https://api.example.com')).toBe(true);
    expect(isValidBaseUrl('http://localhost:8787')).toBe(true);
    expect(isValidBaseUrl('ftp://a.test')).toBe(false);
    expect(isValidBaseUrl('api.example.com')).toBe(false);
    expect(isValidBaseUrl('')).toBe(false);
  });
});
```

`packages/core/src/settings/useSettings.test.ts`：

```ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSettings } from './useSettings';

afterEach(() => {
  localStorage.clear();
});

describe('useSettings', () => {
  it('starts from what is stored', () => {
    localStorage.setItem('oc.settings', JSON.stringify({ apiBaseUrl: 'https://a.test', accessKey: 'k' }));
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings).toEqual({ apiBaseUrl: 'https://a.test', accessKey: 'k' });
  });

  it('saves, normalises and re-renders with the new settings', () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings).toEqual({ apiBaseUrl: '', accessKey: '' });

    act(() => result.current.saveSettings({ apiBaseUrl: 'https://b.test/ ', accessKey: ' k2 ' }));

    expect(result.current.settings).toEqual({ apiBaseUrl: 'https://b.test', accessKey: 'k2' });
    expect(JSON.parse(localStorage.getItem('oc.settings') ?? '')).toEqual({
      apiBaseUrl: 'https://b.test',
      accessKey: 'k2',
    });
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/settings`
Expected: 兩個檔案都 FAIL，`Failed to resolve import "./settingsStore" from "src/settings/settingsStore.test.ts". Does the file exist?` 與 `Failed to resolve import "./useSettings" from "src/settings/useSettings.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/settings/settingsStore.ts`：

```ts
export interface Settings {
  /** Backend origin, e.g. `https://api.example.com` (no trailing slash). */
  apiBaseUrl: string;
  accessKey: string;
}

export const SETTINGS_KEY = 'oc.settings';

export const EMPTY_SETTINGS: Settings = { apiBaseUrl: '', accessKey: '' };

/** Reads the settings from localStorage; missing or broken data gives empty settings. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...EMPTY_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...EMPTY_SETTINGS };
    const { apiBaseUrl, accessKey } = parsed as Record<string, unknown>;
    return {
      apiBaseUrl: typeof apiBaseUrl === 'string' ? apiBaseUrl : '',
      accessKey: typeof accessKey === 'string' ? accessKey : '',
    };
  } catch {
    return { ...EMPTY_SETTINGS };
  }
}

/** Saves normalised settings; a storage failure is logged, never thrown. */
export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
  } catch (error) {
    console.error('Failed to save settings', error);
  }
}

export function normalizeSettings(settings: Settings): Settings {
  return {
    apiBaseUrl: settings.apiBaseUrl.trim().replace(/\/+$/, ''),
    accessKey: settings.accessKey.trim(),
  };
}

/** Recording needs both a backend URL and an access key. */
export function isConfigured(settings: Settings): boolean {
  return settings.apiBaseUrl.trim() !== '' && settings.accessKey.trim() !== '';
}

export function isValidBaseUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
```

`packages/core/src/settings/useSettings.ts`：

```ts
import { useCallback, useState } from 'react';
import { loadSettings, normalizeSettings, saveSettings as persist, type Settings } from './settingsStore';

export interface UseSettingsResult {
  settings: Settings;
  saveSettings(next: Settings): void;
}

/** Settings from localStorage (`oc.settings`) as React state. */
export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const saveSettings = useCallback((next: Settings) => {
    const normalized = normalizeSettings(next);
    persist(normalized);
    setSettings(normalized);
  }, []);
  return { settings, saveSettings };
}
```

`saveSettings` 吞掉 localStorage 的例外（私密模式、容量已滿）只記錄錯誤：設定頁按「儲存」不會讓整個畫面壞掉，`useSettings` 仍以記憶體中的新值繼續運作。

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/settings`
Expected: `Test Files  2 passed (2)`、`Tests  9 passed (9)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/settings
git commit -m "feat(core): add backend settings store and hook"
```

---

### Task 2: API client（`ApiError`、`createApiClient`、`parseRetryAfter`）

**Files:**
- Create: `packages/core/src/api/apiClient.ts`
- Test: `packages/core/src/api/apiClient.test.ts`

- [ ] **Step 1: 寫失敗的測試**

測試以假的 `fetchImpl` 記錄每次呼叫並回傳 `Response`（jsdom 環境中 `Response` 是 Node 內建的，`FormData`／`Blob` 是 jsdom 的）。逾時測試用假計時器。

`packages/core/src/api/apiClient.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, parseRetryAfter } from './apiClient';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/** A fetch stand-in that records each call and answers with `respond`. */
function fakeFetch(respond: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return respond(String(input), init);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const audio = () => new Blob(['RIFF'], { type: 'audio/webm' });

/** Runs a rejecting promise and returns its error. */
async function errorOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('expected the promise to reject');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createApiClient().transcribe', () => {
  it('posts audio, seq and prompt as multipart with the bearer key', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ seq: 3, text: '你好' }));
    const client = createApiClient({ baseUrl: 'https://api.test/', accessKey: 'key-1', fetchImpl });

    const result = await client.transcribe({ audio: audio(), seq: 3, prompt: '上一段', filename: 'segment-3.webm' });

    expect(result).toEqual({ seq: 3, text: '你好' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.test/transcribe');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({ Authorization: 'Bearer key-1' });
    const form = calls[0].init.body as FormData;
    expect(form.get('seq')).toBe('3');
    expect(form.get('prompt')).toBe('上一段');
    const file = form.get('audio') as File;
    expect(file.name).toBe('segment-3.webm');
    expect(file.type).toBe('audio/webm');
  });

  it('turns an error status into ApiError with the server error code', async () => {
    const { fetchImpl } = fakeFetch(() => json({ error: 'unauthorized' }, 401));
    const client = createApiClient({ baseUrl: 'https://api.test', accessKey: 'bad', fetchImpl });

    const error = await errorOf(client.transcribe({ audio: audio(), seq: 1, prompt: '', filename: 'a.webm' }));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.code).toBe('unauthorized');
    expect(error.retryAfterMs).toBeUndefined();
  });

  it('reads Retry-After from a 429', async () => {
    const { fetchImpl } = fakeFetch(() => json({ error: 'rate_limited' }, 429, { 'Retry-After': '3' }));
    const client = createApiClient({ baseUrl: 'https://api.test', accessKey: 'k', fetchImpl });

    const error = await errorOf(client.transcribe({ audio: audio(), seq: 1, prompt: '', filename: 'a.webm' }));

    expect(error.status).toBe(429);
    expect(error.retryAfterMs).toBe(3000);
  });

  it('keeps the status when an error body is not JSON (e.g. a proxy page)', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    const client = createApiClient({ baseUrl: 'https://api.test', accessKey: 'k', fetchImpl });

    const error = await errorOf(client.transcribe({ audio: audio(), seq: 1, prompt: '', filename: 'a.webm' }));

    expect(error.status).toBe(502);
    expect(error.code).toBeUndefined();
  });

  it('reports a network failure as status 0', async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const client = createApiClient({ baseUrl: 'https://api.test', accessKey: 'k', fetchImpl });

    const error = await errorOf(client.transcribe({ audio: audio(), seq: 1, prompt: '', filename: 'a.webm' }));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
  });

  it('rejects a 200 whose body is not a transcribe response', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('<html>login</html>', { status: 200 }));
    const client = createApiClient({ baseUrl: 'https://api.test', accessKey: 'k', fetchImpl });

    const error = await errorOf(client.transcribe({ audio: audio(), seq: 1, prompt: '', filename: 'a.webm' }));

    expect(error.status).toBe(200);
    expect(error.message).toBe('Invalid transcribe response');
  });

  it('aborts a request that takes longer than timeoutMs and reports it as status 0', async () => {
    vi.useFakeTimers();
    const { fetchImpl } = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const client = createApiClient({ baseUrl: 'https://api.test', accessKey: 'k', fetchImpl, timeoutMs: 5000 });

    const pending = errorOf(client.transcribe({ audio: audio(), seq: 1, prompt: '', filename: 'a.webm' }));
    await vi.advanceTimersByTimeAsync(5000);

    expect((await pending).status).toBe(0);
  });
});

describe('createApiClient().health', () => {
  it('is true only for 200 { ok: true } from GET /health, without the key', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ ok: true }));
    const client = createApiClient({ baseUrl: 'http://localhost:8787', accessKey: 'k', fetchImpl });

    expect(await client.health()).toBe(true);
    expect(calls[0].url).toBe('http://localhost:8787/health');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.headers).toBeUndefined();
  });

  it('is false for errors, other bodies and network failures', async () => {
    const answers = [
      () => json({ error: 'bad_request' }, 404),
      () => json({ ok: false }),
      () => new Response('not json'),
      () => {
        throw new TypeError('Failed to fetch');
      },
    ];
    for (const answer of answers) {
      const { fetchImpl } = fakeFetch(answer);
      const client = createApiClient({ baseUrl: 'https://api.test', accessKey: 'k', fetchImpl });
      expect(await client.health()).toBe(false);
    }
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds or an HTTP date and ignores anything else', () => {
    const now = Date.parse('2026-10-21T00:00:00Z');
    expect(parseRetryAfter('45', now)).toBe(45_000);
    expect(parseRetryAfter('0', now)).toBe(0);
    expect(parseRetryAfter('Wed, 21 Oct 2026 00:00:10 GMT', now)).toBe(10_000);
    expect(parseRetryAfter('Tue, 20 Oct 2026 00:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter('soon', now)).toBeUndefined();
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/api/apiClient.test.ts`
Expected: FAIL，`Failed to resolve import "./apiClient" from "src/api/apiClient.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/api/apiClient.ts`：

```ts
import type { ApiErrorCode, TranscribeResponse } from '@oc/shared';

/** A failed API call. `status` is the HTTP status, or 0 for a network error or timeout. */
export class ApiError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;
  readonly code?: ApiErrorCode;

  constructor(
    message: string,
    status: number,
    options: { retryAfterMs?: number; code?: ApiErrorCode; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ApiError';
    this.status = status;
    this.retryAfterMs = options.retryAfterMs;
    this.code = options.code;
  }
}

export interface TranscribeInput {
  audio: Blob;
  seq: number;
  prompt: string;
  filename: string;
}

export interface ApiClient {
  /** GET /health; true only for 200 `{ ok: true }`. Never throws. */
  health(): Promise<boolean>;
  /** POST /transcribe; rejects with ApiError. */
  transcribe(input: TranscribeInput): Promise<TranscribeResponse>;
}

export interface ApiClientOptions {
  baseUrl: string;
  accessKey: string;
  fetchImpl?: typeof fetch;
  /** Abort a request after this long and report it as a network error (status 0). */
  timeoutMs?: number;
}

export const REQUEST_TIMEOUT_MS = 30_000;

const API_ERROR_CODES: readonly string[] = [
  'unauthorized',
  'payload_too_large',
  'rate_limited',
  'bad_request',
  'upstream_error',
];

export function createApiClient({
  baseUrl,
  accessKey,
  // Looked up on every call so tests can stub the global fetch.
  fetchImpl = (input, init) => fetch(input, init),
  timeoutMs = REQUEST_TIMEOUT_MS,
}: ApiClientOptions): ApiClient {
  const root = baseUrl.trim().replace(/\/+$/, '');

  async function send(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(`${root}${path}`, { ...init, signal: controller.signal });
    } catch (cause) {
      throw new ApiError('Network error', 0, { cause });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async health() {
      try {
        const res = await send('/health', { method: 'GET' });
        if (!res.ok) return false;
        const body = await readJson(res);
        return isRecord(body) && body.ok === true;
      } catch {
        return false;
      }
    },

    async transcribe({ audio, seq, prompt, filename }) {
      const form = new FormData();
      form.append('audio', audio, filename);
      form.append('seq', String(seq));
      form.append('prompt', prompt);
      const res = await send('/transcribe', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessKey}` },
        body: form,
      });
      const body = await readJson(res);
      if (!res.ok) {
        const code =
          isRecord(body) && typeof body.error === 'string' && API_ERROR_CODES.includes(body.error)
            ? (body.error as ApiErrorCode)
            : undefined;
        throw new ApiError(`Request failed with status ${res.status}`, res.status, {
          code,
          retryAfterMs: parseRetryAfter(res.headers.get('Retry-After')),
        });
      }
      if (!isRecord(body) || typeof body.seq !== 'number' || typeof body.text !== 'string') {
        throw new ApiError('Invalid transcribe response', res.status);
      }
      return { seq: body.seq, text: body.text };
    },
  };
}

/** `Retry-After` in ms: delta-seconds or an HTTP date; undefined when missing or unreadable. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    // Proxies and gateways may answer with HTML or plain text.
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
```

重點：
- 契約要求網路錯誤的 `status = 0`；逾時（`AbortController`）也走同一條路，`withRetry` 會重試。
- M3a 保證自己產生的錯誤都是 JSON，但代理伺服器的錯誤頁可能是 HTML，所以 body 解析失敗時仍以 `res.status` 建立 `ApiError`。
- `Retry-After` 支援秒數與 HTTP 日期兩種格式；M3a 送的是秒數（且已用 `Access-Control-Expose-Headers` 公開）。
- `super(message, { cause })` 使用 ES2022 的 `ErrorOptions`（`tsconfig.base.json` 的 lib 為 ES2022）。

- [ ] **Step 4: 執行測試與型別檢查，確認通過**

Run: `npm test -w @oc/core -- src/api/apiClient.test.ts && npm run typecheck -w @oc/core`
Expected: `Tests  10 passed (10)`；typecheck 無錯誤。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/api
git commit -m "feat(core): add transcribe API client with timeouts and typed errors"
```

---

### Task 3: 設定對話框 `SettingsDialog`

**Files:**
- Create: `packages/core/src/components/SettingsDialog.tsx`
- Test: `packages/core/src/components/SettingsDialog.test.tsx`

- [ ] **Step 1: 寫失敗的測試**

「測試連線」的結果以注入的 `checkHealth` 控制；另有一個測試不注入，改用 `vi.stubGlobal('fetch', …)` 確認預設會呼叫 `GET <網址>/health`。

`packages/core/src/components/SettingsDialog.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../settings/settingsStore';
import { SettingsDialog } from './SettingsDialog';

function setup(settings: Settings = { apiBaseUrl: '', accessKey: '' }, checkHealth = vi.fn(async (_url: string) => true)) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(<SettingsDialog settings={settings} onSave={onSave} onClose={onClose} checkHealth={checkHealth} />);
  return {
    onSave,
    onClose,
    checkHealth,
    user: userEvent.setup(),
    url: screen.getByLabelText('後端網址'),
    key: screen.getByLabelText('存取金鑰'),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SettingsDialog', () => {
  it('shows the current settings in a modal dialog titled 設定', () => {
    const { url, key } = setup({ apiBaseUrl: 'https://api.test', accessKey: 'k1' });
    const dialog = screen.getByRole('dialog', { name: '設定' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(url).toHaveValue('https://api.test');
    expect(url).toHaveFocus();
    expect(key).toHaveValue('k1');
    expect(key).toHaveAttribute('type', 'password');
  });

  it('saves trimmed settings without a trailing slash', async () => {
    const { user, url, key, onSave } = setup();
    await user.type(url, ' https://api.test/ ');
    await user.type(key, ' secret ');
    await user.click(screen.getByRole('button', { name: '儲存' }));
    expect(onSave).toHaveBeenCalledWith({ apiBaseUrl: 'https://api.test', accessKey: 'secret' });
  });

  it('refuses a URL that is not http or https', async () => {
    const { user, url, onSave } = setup();
    await user.type(url, 'api.test');
    await user.click(screen.getByRole('button', { name: '儲存' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('請輸入 http:// 或 https:// 開頭的網址')).toBeInTheDocument();
  });

  it('allows clearing the settings', async () => {
    const { user, url, key, onSave } = setup({ apiBaseUrl: 'https://api.test', accessKey: 'k1' });
    await user.clear(url);
    await user.clear(key);
    await user.click(screen.getByRole('button', { name: '儲存' }));
    expect(onSave).toHaveBeenCalledWith({ apiBaseUrl: '', accessKey: '' });
  });

  it('tests the connection with the URL being edited', async () => {
    let answer: (ok: boolean) => void = () => undefined;
    const checkHealth = vi.fn((_url: string) => new Promise<boolean>((resolve) => (answer = resolve)));
    const { user, url } = setup({ apiBaseUrl: '', accessKey: '' }, checkHealth);
    await user.type(url, 'http://localhost:8787/');
    await user.click(screen.getByRole('button', { name: '測試連線' }));

    expect(checkHealth).toHaveBeenCalledWith('http://localhost:8787');
    expect(screen.getByText('測試中…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '測試連線' })).toBeDisabled();

    answer(true);
    expect(await screen.findByText('連線成功')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '測試連線' })).toBeEnabled();
  });

  it('reports a failed connection test and an unusable URL', async () => {
    const checkHealth = vi.fn(async (_url: string) => false);
    const { user, url } = setup({ apiBaseUrl: 'https://down.test', accessKey: '' }, checkHealth);
    await user.click(screen.getByRole('button', { name: '測試連線' }));
    expect(await screen.findByText('連線失敗，請確認後端網址')).toBeInTheDocument();

    await user.clear(url);
    await user.click(screen.getByRole('button', { name: '測試連線' }));
    expect(screen.getByText('請輸入 http:// 或 https:// 開頭的網址')).toBeInTheDocument();
    expect(checkHealth).toHaveBeenCalledTimes(1);
  });

  it('calls GET <url>/health when no checkHealth is given', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <SettingsDialog
        settings={{ apiBaseUrl: 'https://api.test', accessKey: '' }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: '測試連線' }));
    expect(await screen.findByText('連線成功')).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.test/health');
  });

  it('closes on 取消 and on Escape without saving', async () => {
    const { user, onClose, onSave } = setup();
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/components/SettingsDialog.test.tsx`
Expected: FAIL，`Failed to resolve import "./SettingsDialog" from "src/components/SettingsDialog.test.tsx". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/components/SettingsDialog.tsx`：

```tsx
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createApiClient } from '../api/apiClient';
import { isValidBaseUrl, normalizeSettings, type Settings } from '../settings/settingsStore';

export const SETTINGS_MESSAGES = {
  testing: '測試中…',
  ok: '連線成功',
  failed: '連線失敗，請確認後端網址',
  invalidUrl: '請輸入 http:// 或 https:// 開頭的網址',
} as const;

export interface SettingsDialogProps {
  settings: Settings;
  /** Receives normalised settings; the parent saves them and closes the dialog. */
  onSave(next: Settings): void;
  onClose(): void;
  /** GET {baseUrl}/health by default; injectable for tests. */
  checkHealth?: (baseUrl: string) => Promise<boolean>;
}

const defaultCheckHealth = (baseUrl: string) => createApiClient({ baseUrl, accessKey: '' }).health();

/** 設定: backend URL, access key and a 測試連線 button. Render it only while it is open. */
export function SettingsDialog({
  settings,
  onSave,
  onClose,
  checkHealth = defaultCheckHealth,
}: SettingsDialogProps) {
  const [apiBaseUrl, setApiBaseUrl] = useState(settings.apiBaseUrl);
  const [accessKey, setAccessKey] = useState(settings.accessKey);
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const urlId = useId();
  const keyId = useId();

  useEffect(() => {
    urlRef.current?.focus();
  }, []);

  const testConnection = async () => {
    const { apiBaseUrl: url } = normalizeSettings({ apiBaseUrl, accessKey });
    if (!isValidBaseUrl(url)) {
      setMessage(SETTINGS_MESSAGES.invalidUrl);
      return;
    }
    setTesting(true);
    setMessage(SETTINGS_MESSAGES.testing);
    const ok = await checkHealth(url);
    setTesting(false);
    setMessage(ok ? SETTINGS_MESSAGES.ok : SETTINGS_MESSAGES.failed);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = normalizeSettings({ apiBaseUrl, accessKey });
    if (next.apiBaseUrl !== '' && !isValidBaseUrl(next.apiBaseUrl)) {
      setMessage(SETTINGS_MESSAGES.invalidUrl);
      urlRef.current?.focus();
      return;
    }
    onSave(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className="oc-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="oc-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="oc-dialog-title">
          設定
        </h2>
        <form className="oc-dialog-form" noValidate onSubmit={submit}>
          <label htmlFor={urlId}>後端網址</label>
          <input
            ref={urlRef}
            id={urlId}
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://api.example.com"
            value={apiBaseUrl}
            onChange={(event) => setApiBaseUrl(event.target.value)}
          />
          <label htmlFor={keyId}>存取金鑰</label>
          <input
            id={keyId}
            type="password"
            autoComplete="off"
            value={accessKey}
            onChange={(event) => setAccessKey(event.target.value)}
          />
          <p className="oc-dialog-hint">存取金鑰只會儲存在這台裝置上。</p>
          <div className="oc-dialog-test">
            <button
              type="button"
              className="oc-action-btn"
              disabled={testing}
              onClick={() => void testConnection()}
            >
              測試連線
            </button>
            <p className="oc-dialog-message" aria-live="polite">
              {message}
            </p>
          </div>
          <div className="oc-dialog-actions">
            <button type="button" className="oc-action-btn" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="oc-primary-btn">
              儲存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

不用原生 `<dialog>`：jsdom 26 沒有實作 `showModal()`。改用 `role="dialog"` + `aria-modal="true"` 的一般元素，開啟時焦點移到「後端網址」，Esc 與點背景關閉。表單加 `noValidate`，網址格式由 `isValidBaseUrl` 檢查（避免各瀏覽器原生驗證泡泡不一致）；`type="url"` 仍保留給手機鍵盤。訊息列用 `aria-live="polite"` 而不是 `role="status"`（見「與共用契約的關係」）。

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/components/SettingsDialog.test.tsx`
Expected: `Tests  8 passed (8)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/components/SettingsDialog.tsx packages/core/src/components/SettingsDialog.test.tsx
git commit -m "feat(core): add settings dialog with connection test"
```

---

### Task 4: 錄音格式與音量（`pickMimeType`、`computeRms`）

**Files:**
- Create: `packages/core/src/recording/pickMimeType.ts`
- Create: `packages/core/src/recording/rms.ts`
- Test: `packages/core/src/recording/pickMimeType.test.ts`
- Test: `packages/core/src/recording/rms.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/recording/pickMimeType.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extensionFor, MIME_TYPE_CANDIDATES, pickMimeType } from './pickMimeType';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pickMimeType', () => {
  it('tries webm/opus first, then mp4', () => {
    expect(MIME_TYPE_CANDIDATES).toEqual(['audio/webm;codecs=opus', 'audio/mp4']);
    expect(pickMimeType(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickMimeType((type) => type === 'audio/mp4')).toBe('audio/mp4');
  });

  it('returns undefined when no candidate is supported', () => {
    expect(pickMimeType(() => false)).toBeUndefined();
  });

  it('asks MediaRecorder.isTypeSupported by default', () => {
    const isTypeSupported = vi.fn((type: string) => type === 'audio/mp4');
    vi.stubGlobal('MediaRecorder', { isTypeSupported });
    expect(pickMimeType()).toBe('audio/mp4');
    expect(isTypeSupported).toHaveBeenCalledWith('audio/webm;codecs=opus');
  });

  it('returns undefined when MediaRecorder does not exist (jsdom)', () => {
    expect(typeof MediaRecorder).toBe('undefined');
    expect(pickMimeType()).toBeUndefined();
  });
});

describe('extensionFor', () => {
  it('maps mp4 audio to mp4 and everything else to webm', () => {
    expect(extensionFor('audio/mp4')).toBe('mp4');
    expect(extensionFor('audio/mp4;codecs=mp4a.40.2')).toBe('mp4');
    expect(extensionFor('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionFor('')).toBe('webm');
  });
});
```

`packages/core/src/recording/rms.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { computeRms } from './rms';

describe('computeRms', () => {
  it('is 0 for silence and for an empty buffer', () => {
    expect(computeRms(new Float32Array(128))).toBe(0);
    expect(computeRms(new Float32Array(0))).toBe(0);
  });

  it('is the amplitude of a constant or square signal', () => {
    expect(computeRms(new Float32Array([0.5, 0.5, 0.5, 0.5]))).toBeCloseTo(0.5);
    expect(computeRms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
  });

  it('is amplitude / sqrt(2) for a sine wave', () => {
    const sine = Float32Array.from({ length: 1000 }, (_, i) => Math.sin((2 * Math.PI * i) / 100));
    expect(computeRms(sine)).toBeCloseTo(Math.SQRT1_2, 3);
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/recording/pickMimeType.test.ts src/recording/rms.test.ts`
Expected: 兩個檔案都 FAIL，`Failed to resolve import "./pickMimeType"` 與 `Failed to resolve import "./rms"`。

- [ ] **Step 3: 實作**

`packages/core/src/recording/pickMimeType.ts`：

```ts
/** Tried in order; Chrome/Edge/Android record webm/opus, Safari/iOS records mp4. */
export const MIME_TYPE_CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4'] as const;

/** First supported recording format, or undefined to let MediaRecorder choose. */
export function pickMimeType(
  isSupported: (type: string) => boolean = defaultIsSupported,
): string | undefined {
  return MIME_TYPE_CANDIDATES.find((type) => isSupported(type));
}

/** File extension for an uploaded segment. */
export function extensionFor(mimeType: string): 'webm' | 'mp4' {
  return mimeType.startsWith('audio/mp4') ? 'mp4' : 'webm';
}

function defaultIsSupported(type: string): boolean {
  return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type);
}
```

`packages/core/src/recording/rms.ts`：

```ts
/** Root mean square of time-domain samples in [-1, 1]; 0 for an empty buffer. */
export function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/recording/pickMimeType.test.ts src/recording/rms.test.ts`
Expected: `Test Files  2 passed (2)`、`Tests  8 passed (8)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recording/pickMimeType.ts packages/core/src/recording/pickMimeType.test.ts packages/core/src/recording/rms.ts packages/core/src/recording/rms.test.ts
git commit -m "feat(core): pick a recording format and measure RMS volume"
```

---

### Task 5: 切段規則 `SegmentPolicy`

**Files:**
- Create: `packages/core/src/recording/segmentPolicy.ts`
- Test: `packages/core/src/recording/segmentPolicy.test.ts`

- [ ] **Step 1: 寫失敗的測試**

以每 50ms 一個讀數模擬 `SegmentRecorder` 的輪詢；`run()` 回傳第一次 `'cut'` 的時間點。

`packages/core/src/recording/segmentPolicy.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { SegmentPolicy } from './segmentPolicy';

const SPEECH = 0.2;
const SILENCE = 0.001;

/** Feeds one rms value every 50ms from `fromMs` up to and including `toMs`; returns the first cut time. */
function run(policy: SegmentPolicy, fromMs: number, toMs: number, rmsAt: (t: number) => number) {
  for (let t = fromMs; t <= toMs; t += 50) {
    if (policy.update(t, rmsAt(t)) === 'cut') return t;
  }
  return undefined;
}

describe('SegmentPolicy', () => {
  it('never cuts before 4 seconds, even during a pause', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    expect(run(policy, 50, 3950, () => SILENCE)).toBeUndefined();
  });

  it('cuts at 4 seconds when a pause of 300ms is already going on', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    expect(run(policy, 50, 8000, (t) => (t < 3500 ? SPEECH : SILENCE))).toBe(4000);
  });

  it('cuts once a pause after 4 seconds has lasted 300ms', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    // Silence starts at 5000; 300ms later is 5300.
    expect(run(policy, 50, 8000, (t) => (t < 5000 ? SPEECH : SILENCE))).toBe(5300);
  });

  it('restarts the pause timer when speech comes back', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    const rmsAt = (t: number) => {
      if (t >= 5000 && t < 5200) return SILENCE; // too short
      if (t >= 6000) return SILENCE;
      return SPEECH;
    };
    expect(run(policy, 50, 8000, rmsAt)).toBe(6300);
  });

  it('forces a cut at 8 seconds without any pause', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    expect(run(policy, 50, 10_000, () => SPEECH)).toBe(8000);
  });

  it('treats values at or above the 0.01 threshold as speech', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    expect(run(policy, 50, 10_000, () => 0.01)).toBe(8000);
  });

  it('measures each segment from its own start', () => {
    const policy = new SegmentPolicy();
    policy.start(0);
    expect(run(policy, 50, 10_000, () => SPEECH)).toBe(8000);
    policy.start(8000);
    expect(run(policy, 8050, 20_000, () => SPEECH)).toBe(16_000);
  });

  it('accepts custom limits', () => {
    const policy = new SegmentPolicy({ minMs: 1000, maxMs: 2000, silenceMs: 100, threshold: 0.5 });
    policy.start(0);
    expect(run(policy, 50, 5000, (t) => (t < 1200 ? 0.6 : 0.4))).toBe(1300);
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/recording/segmentPolicy.test.ts`
Expected: FAIL，`Failed to resolve import "./segmentPolicy" from "src/recording/segmentPolicy.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/recording/segmentPolicy.ts`：

```ts
export interface SegmentPolicyOptions {
  /** No cut before this much audio (default 4000ms). */
  minMs?: number;
  /** Always cut at this length (default 8000ms). */
  maxMs?: number;
  /** A pause must last this long (default 300ms). */
  silenceMs?: number;
  /** RMS below this counts as silence (default 0.01). */
  threshold?: number;
}

/**
 * Decides when to end a recording segment: at a pause (RMS < threshold for silenceMs) once minMs
 * have passed, or at maxMs regardless. Call start() at the beginning of every segment.
 */
export class SegmentPolicy {
  private readonly minMs: number;
  private readonly maxMs: number;
  private readonly silenceMs: number;
  private readonly threshold: number;
  private startMs = 0;
  private silenceStartMs: number | null = null;

  constructor(options: SegmentPolicyOptions = {}) {
    this.minMs = options.minMs ?? 4000;
    this.maxMs = options.maxMs ?? 8000;
    this.silenceMs = options.silenceMs ?? 300;
    this.threshold = options.threshold ?? 0.01;
  }

  start(nowMs: number): void {
    this.startMs = nowMs;
    this.silenceStartMs = null;
  }

  update(nowMs: number, rms: number): 'continue' | 'cut' {
    if (rms < this.threshold) this.silenceStartMs ??= nowMs;
    else this.silenceStartMs = null;

    const elapsed = nowMs - this.startMs;
    if (elapsed >= this.maxMs) return 'cut';
    const pausedFor = this.silenceStartMs === null ? 0 : nowMs - this.silenceStartMs;
    if (elapsed >= this.minMs && pausedFor >= this.silenceMs) return 'cut';
    return 'continue';
  }
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/recording/segmentPolicy.test.ts`
Expected: `Tests  8 passed (8)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recording/segmentPolicy.ts packages/core/src/recording/segmentPolicy.test.ts
git commit -m "feat(core): add pause-based segment policy (4-8s, 300ms below 0.01 RMS)"
```

---

### Task 6: 測試替身與切段錄音器 `SegmentRecorder`

**Files:**
- Create: `packages/core/src/test/media.ts`
- Create: `packages/core/src/recording/segmentRecorder.ts`
- Test: `packages/core/src/recording/segmentRecorder.test.ts`

- [ ] **Step 1: 建立瀏覽器 API 的測試替身（Task 6、15 共用）**

jsdom 沒有 `MediaRecorder`、`MediaStream`、`AudioContext`。`FakeMediaRecorder` 與真的一樣在 `stop()` 之後**非同步**送出 `dataavailable`、`stop`（用 `queueMicrotask`，不受假計時器影響）；`createFakeAudioContext` 的 analyser 回報 `setLevel()` 設定的固定音量。

`packages/core/src/test/media.ts`：

```ts
import { vi } from 'vitest';

/**
 * jsdom has no MediaRecorder. This fake records how it was used and, like the real one, fires
 * `dataavailable` then `stop` asynchronously after stop(). Install it with
 * `vi.stubGlobal('MediaRecorder', FakeMediaRecorder)` and call `FakeMediaRecorder.reset()` first.
 */
export class FakeMediaRecorder extends EventTarget {
  static instances: FakeMediaRecorder[] = [];
  static supportedTypes = ['audio/webm;codecs=opus', 'audio/mp4'];

  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supportedTypes.includes(type);
  }

  static reset(): void {
    FakeMediaRecorder.instances = [];
  }

  /** What the next stop() delivers; '' simulates a segment without any data. */
  data = 'audio';
  state: RecordingState = 'inactive';
  readonly mimeType: string;
  startArgs: unknown[] = [];

  constructor(
    readonly stream: MediaStream,
    readonly options?: MediaRecorderOptions,
  ) {
    super();
    this.mimeType = options?.mimeType ?? 'audio/webm';
    FakeMediaRecorder.instances.push(this);
  }

  start(...args: unknown[]): void {
    this.startArgs = args;
    this.state = 'recording';
  }

  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    const blob = new Blob(this.data ? [this.data] : [], { type: this.mimeType });
    queueMicrotask(() => {
      this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: blob }));
      this.dispatchEvent(new Event('stop'));
    });
  }
}

/** A one-track MediaStream stand-in; end() fires the track's `ended` event. */
export function createFakeStream() {
  const track = Object.assign(new EventTarget(), {
    kind: 'audio',
    readyState: 'live' as MediaStreamTrackState,
    stop: vi.fn(() => {
      track.readyState = 'ended';
    }),
  });
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track, end: () => track.dispatchEvent(new Event('ended')) };
}

/** An AudioContext stand-in whose analyser reports a constant level set with setLevel(). */
export function createFakeAudioContext() {
  let level = 0;
  const close = vi.fn(async () => undefined);
  const context = {
    state: 'running',
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
    createAnalyser: () => ({
      fftSize: 2048,
      getFloatTimeDomainData: (array: Float32Array) => array.fill(level),
    }),
    resume: vi.fn(async () => undefined),
    close,
  };
  return {
    context: context as unknown as AudioContext,
    close,
    setLevel: (value: number) => {
      level = value;
    },
  };
}
```

- [ ] **Step 2: 寫失敗的測試**

以 `vi.useFakeTimers({ now: 0 })` 同時控制輪詢的 `setInterval` 與 `Date.now()`（`SegmentRecorder` 預設的時鐘）；`vi.advanceTimersByTimeAsync` 推進時間並讓 microtask（假錄音器的 stop 事件）跑完。jsdom 的 `FileReader` 在假計時器下不會觸發 load，所以只檢查 `blob.size`。

`packages/core/src/recording/segmentRecorder.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAudioContext, createFakeStream, FakeMediaRecorder } from '../test/media';
import { SegmentRecorder } from './segmentRecorder';

const SPEECH = 0.2;

function setup(options: { mimeType?: string; audioContext?: 'fake' | 'throws' } = {}) {
  const { stream, track, end } = createFakeStream();
  const audio = createFakeAudioContext();
  audio.setLevel(SPEECH);
  const segments: { seq: number; blob: Blob }[] = [];
  const onInterrupted = vi.fn();
  const recorder = new SegmentRecorder({
    stream,
    mimeType: options.mimeType,
    onSegment: (segment) => segments.push(segment),
    onInterrupted,
    createAudioContext:
      options.audioContext === 'throws'
        ? () => {
            throw new Error('no audio context');
          }
        : () => audio.context,
  });
  return { recorder, segments, onInterrupted, audio, track, end };
}

const recorders = () => FakeMediaRecorder.instances;

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
  FakeMediaRecorder.reset();
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SegmentRecorder', () => {
  it('starts one MediaRecorder with the mime type and no timeslice', () => {
    const { recorder } = setup({ mimeType: 'audio/webm;codecs=opus' });
    recorder.start();
    expect(recorders()).toHaveLength(1);
    expect(recorders()[0].options).toEqual({ mimeType: 'audio/webm;codecs=opus' });
    expect(recorders()[0].startArgs).toEqual([]);
    expect(recorders()[0].state).toBe('recording');
  });

  it('lets MediaRecorder choose the format when no mime type is given', () => {
    const { recorder } = setup();
    recorder.start();
    expect(recorders()[0].options).toBeUndefined();
  });

  it('cuts 300ms into a pause after 4 seconds and opens a new MediaRecorder', async () => {
    const { recorder, segments, audio } = setup();
    recorder.start();

    await vi.advanceTimersByTimeAsync(4000);
    audio.setLevel(0);
    // The first silent reading is at 4050ms, so the pause reaches 300ms at 4350ms.
    await vi.advanceTimersByTimeAsync(300);
    expect(recorders()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(50);
    expect(recorders()).toHaveLength(2);
    expect(recorders()[0].state).toBe('inactive');
    expect(recorders()[1].state).toBe('recording');
    expect(segments.map((s) => s.seq)).toEqual([1]);
    expect(segments[0].blob.type).toBe('audio/webm');
    expect(segments[0].blob.size).toBe('audio'.length);
  });

  it('forces a cut every 8 seconds while someone keeps talking', async () => {
    const { recorder, segments } = setup();
    recorder.start();
    await vi.advanceTimersByTimeAsync(7950);
    expect(recorders()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(recorders()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(8000);
    expect(recorders()).toHaveLength(3);
    expect(segments.map((s) => s.seq)).toEqual([1, 2]);
  });

  it('stop() delivers the last segment, then stops polling and closes the audio context', async () => {
    const { recorder, segments, audio } = setup();
    recorder.start();
    await vi.advanceTimersByTimeAsync(8000);

    await recorder.stop();

    expect(segments.map((s) => s.seq)).toEqual([1, 2]);
    expect(recorders().every((r) => r.state === 'inactive')).toBe(true);
    expect(audio.close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(recorders()).toHaveLength(2);
  });

  it('stop() can be called twice', async () => {
    const { recorder, segments } = setup();
    recorder.start();
    await Promise.all([recorder.stop(), recorder.stop()]);
    expect(segments.map((s) => s.seq)).toEqual([1]);
  });

  it('skips a segment without data and keeps the numbers gapless', async () => {
    const { recorder, segments } = setup();
    recorder.start();
    recorders()[0].data = '';
    await vi.advanceTimersByTimeAsync(8000);
    await recorder.stop();
    expect(segments.map((s) => s.seq)).toEqual([1]);
    expect(segments[0].blob.size).toBe('audio'.length);
  });

  it('reports an ended track as an interruption and delivers what was recorded', async () => {
    const { recorder, segments, onInterrupted, end } = setup();
    recorder.start();
    await vi.advanceTimersByTimeAsync(2000);

    end();
    await vi.advanceTimersByTimeAsync(0);

    expect(onInterrupted).toHaveBeenCalledTimes(1);
    expect(segments.map((s) => s.seq)).toEqual([1]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(recorders()).toHaveLength(1);
  });

  it('falls back to 8-second segments when there is no AudioContext', async () => {
    const { recorder } = setup({ audioContext: 'throws' });
    recorder.start();
    await vi.advanceTimersByTimeAsync(7950);
    expect(recorders()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(recorders()).toHaveLength(2);
    await recorder.stop();
  });
});
```

- [ ] **Step 3: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/recording/segmentRecorder.test.ts`
Expected: FAIL，`Failed to resolve import "./segmentRecorder" from "src/recording/segmentRecorder.test.ts". Does the file exist?`

- [ ] **Step 4: 實作**

`packages/core/src/recording/segmentRecorder.ts`：

```ts
import { computeRms } from './rms';
import { SegmentPolicy } from './segmentPolicy';

export interface RecordedSegment {
  /** 1, 2, 3… in recording order, without gaps. */
  seq: number;
  blob: Blob;
}

export interface SegmentRecorderOptions {
  stream: MediaStream;
  /** From pickMimeType(); undefined lets MediaRecorder choose. */
  mimeType?: string;
  onSegment(segment: RecordedSegment): void;
  /** A track of the stream ended (device unplugged, app sent to the background…). */
  onInterrupted(): void;
  policy?: SegmentPolicy;
  now?: () => number;
  createAudioContext?: () => AudioContext;
  /** How often the volume is checked (default 50ms). */
  pollMs?: number;
}

interface Segment {
  recorder: MediaRecorder;
  /** Settles once the recorder's `stop` event has been handled. */
  done: Promise<void>;
}

/**
 * Records a stream as a series of independently decodable files: every segment gets its own
 * MediaRecorder (no timeslice, whose later chunks lack the container header). A SegmentPolicy
 * fed with the analyser's RMS decides where to cut.
 */
export class SegmentRecorder {
  private readonly policy: SegmentPolicy;
  private readonly now: () => number;
  private current: Segment | null = null;
  private nextSeq = 1;
  private timer: ReturnType<typeof setInterval> | undefined;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples = new Float32Array(0);
  private started = false;
  private stopping: Promise<void> | null = null;

  constructor(private readonly options: SegmentRecorderOptions) {
    this.policy = options.policy ?? new SegmentPolicy();
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.setUpAnalyser();
    for (const track of this.options.stream.getTracks()) {
      track.addEventListener('ended', this.onTrackEnded);
    }
    this.current = this.beginSegment();
    this.policy.start(this.now());
    this.timer = setInterval(() => this.poll(), this.options.pollMs ?? 50);
  }

  /** Ends recording; resolves after the last segment has been passed to onSegment. */
  stop(): Promise<void> {
    if (!this.started) return Promise.resolve();
    this.stopping ??= this.finish();
    return this.stopping;
  }

  private readonly onTrackEnded = () => {
    if (this.stopping) return;
    this.options.onInterrupted();
    void this.stop();
  };

  private async finish(): Promise<void> {
    clearInterval(this.timer);
    for (const track of this.options.stream.getTracks()) {
      track.removeEventListener('ended', this.onTrackEnded);
    }
    const last = this.current;
    this.current = null;
    if (last) {
      if (last.recorder.state !== 'inactive') last.recorder.stop();
      await last.done;
    }
    await this.audioContext?.close().catch(() => undefined);
  }

  private poll(): void {
    if (!this.current || this.stopping) return;
    if (this.policy.update(this.now(), this.readRms()) === 'cut') this.cut();
  }

  private cut(): void {
    const previous = this.current;
    if (!previous) return;
    if (previous.recorder.state !== 'inactive') previous.recorder.stop();
    this.current = this.beginSegment();
    this.policy.start(this.now());
  }

  private beginSegment(): Segment {
    const { stream, mimeType } = this.options;
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    const done = new Promise<void>((resolve) => {
      recorder.addEventListener(
        'stop',
        () => {
          try {
            if (chunks.length > 0) {
              const type = recorder.mimeType || mimeType || '';
              // Numbered when delivered, so an empty segment never leaves a hole in the sequence.
              this.options.onSegment({ seq: this.nextSeq++, blob: new Blob(chunks, { type }) });
            }
          } finally {
            resolve();
          }
        },
        { once: true },
      );
    });
    recorder.start();
    return { recorder, done };
  }

  private setUpAnalyser(): void {
    try {
      const context = (this.options.createAudioContext ?? (() => new AudioContext()))();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(this.options.stream).connect(analyser);
      // Some browsers create a suspended context; the 錄製 click lets it resume.
      if (context.state === 'suspended') void context.resume().catch(() => undefined);
      this.audioContext = context;
      this.analyser = analyser;
      this.samples = new Float32Array(analyser.fftSize);
    } catch {
      // Without an analyser every reading counts as speech, so segments are cut at maxMs.
      this.audioContext = null;
      this.analyser = null;
    }
  }

  private readRms(): number {
    if (!this.analyser) return 1;
    this.analyser.getFloatTimeDomainData(this.samples);
    return computeRms(this.samples);
  }
}
```

重點：
- 每段 `new MediaRecorder(stream, { mimeType })` 後呼叫不帶參數的 `start()`（不用 timeslice），停止時一次拿到完整、可獨立解碼的檔案。切段時先停舊的再開新的，空隙約一次事件迴圈（spec 允許約 20ms）。
- `seq` 在 `stop` 事件、確定有資料時才遞增；`stop` 事件依停止順序發生，所以編號就是錄音順序。
- 未連到 `destination` 的 `AnalyserNode` 在 Chrome／Safari 仍會被處理（analyser 是 automatic pull node），不需要把麥克風接到喇叭。
- `samples` 以 `new Float32Array(...)` 推斷型別（TS 5.9 為 `Float32Array<ArrayBuffer>`），符合 `getFloatTimeDomainData` 的參數型別。

- [ ] **Step 5: 執行測試與型別檢查，確認通過**

Run: `npm test -w @oc/core -- src/recording/segmentRecorder.test.ts && npm run typecheck -w @oc/core`
Expected: `Tests  9 passed (9)`；typecheck 無錯誤。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/test/media.ts packages/core/src/recording/segmentRecorder.ts packages/core/src/recording/segmentRecorder.test.ts
git commit -m "feat(core): record independently decodable segments cut at pauses"
```

---

### Task 7: 依序緩衝 `OrderedBuffer`

**Files:**
- Create: `packages/core/src/recording/orderedBuffer.ts`
- Test: `packages/core/src/recording/orderedBuffer.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/recording/orderedBuffer.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { OrderedBuffer } from './orderedBuffer';

describe('OrderedBuffer', () => {
  it('releases items that arrive in order straight away', () => {
    const buffer = new OrderedBuffer<string>();
    expect(buffer.put(1, 'a')).toEqual(['a']);
    expect(buffer.put(2, 'b')).toEqual(['b']);
  });

  it('holds later items until the gap before them is filled', () => {
    const buffer = new OrderedBuffer<string>();
    expect(buffer.put(3, 'c')).toEqual([]);
    expect(buffer.put(2, 'b')).toEqual([]);
    expect(buffer.put(1, 'a')).toEqual(['a', 'b', 'c']);
    expect(buffer.put(4, 'd')).toEqual(['d']);
  });

  it('ignores duplicates and items that were already released', () => {
    const buffer = new OrderedBuffer<string>();
    expect(buffer.put(2, 'b')).toEqual([]);
    expect(buffer.put(2, 'B')).toEqual([]);
    expect(buffer.put(1, 'a')).toEqual(['a', 'b']);
    expect(buffer.put(1, 'again')).toEqual([]);
  });

  it('can start from another sequence number', () => {
    const buffer = new OrderedBuffer<number>(5);
    expect(buffer.put(6, 60)).toEqual([]);
    expect(buffer.put(5, 50)).toEqual([50, 60]);
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/recording/orderedBuffer.test.ts`
Expected: FAIL，`Failed to resolve import "./orderedBuffer" from "src/recording/orderedBuffer.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/recording/orderedBuffer.ts`：

```ts
/** Re-orders results that arrive in any order so they can be used strictly by sequence number. */
export class OrderedBuffer<T> {
  private next: number;
  private readonly waiting = new Map<number, T>();

  constructor(firstSeq = 1) {
    this.next = firstSeq;
  }

  /** Stores `value` and returns every item that can now be released, in order. */
  put(seq: number, value: T): T[] {
    if (seq < this.next || this.waiting.has(seq)) return [];
    this.waiting.set(seq, value);
    const ready: T[] = [];
    while (this.waiting.has(this.next)) {
      ready.push(this.waiting.get(this.next) as T);
      this.waiting.delete(this.next);
      this.next += 1;
    }
    return ready;
  }
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/recording/orderedBuffer.test.ts`
Expected: `Tests  4 passed (4)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recording/orderedBuffer.ts packages/core/src/recording/orderedBuffer.test.ts
git commit -m "feat(core): add ordered buffer that releases results by seq"
```

---

### Task 8: 重試 `withRetry`

**Files:**
- Create: `packages/core/src/recording/retry.ts`
- Test: `packages/core/src/recording/retry.test.ts`

- [ ] **Step 1: 寫失敗的測試**

除了最後一個測試（確認預設用真的 `setTimeout` 等待，以假計時器推進），其餘都注入記錄用的 `sleep`，不需要等待。

`packages/core/src/recording/retry.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/apiClient';
import { RETRY_DELAYS_MS, withRetry } from './retry';

/** fn that fails with the given errors in turn, then resolves 'ok'. */
function failing(...errors: unknown[]) {
  return vi.fn(async () => {
    const error = errors.shift();
    if (error !== undefined) throw error;
    return 'ok';
  });
}

const sleepSpy = () => vi.fn(async (_ms: number) => undefined);

afterEach(() => {
  vi.useRealTimers();
});

describe('withRetry', () => {
  it('returns the first success without sleeping', async () => {
    const sleep = sleepSpy();
    expect(await withRetry(failing(), { sleep })).toBe('ok');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries network errors and 5xx after 1s, 2s and 4s', async () => {
    const sleep = sleepSpy();
    const fn = failing(new ApiError('net', 0), new ApiError('bad gateway', 502), new ApiError('down', 500));
    expect(RETRY_DELAYS_MS).toEqual([1000, 2000, 4000]);
    expect(await withRetry(fn, { sleep })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
  });

  it('gives up after 3 retries and throws the last error', async () => {
    const sleep = sleepSpy();
    const last = new ApiError('fourth', 500);
    const fn = failing(new ApiError('1', 500), new ApiError('2', 500), new ApiError('3', 500), last);
    await expect(withRetry(fn, { sleep })).rejects.toBe(last);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('waits Retry-After on 429 and counts it as a retry', async () => {
    const sleep = sleepSpy();
    const fn = failing(new ApiError('slow down', 429, { retryAfterMs: 7000 }), new ApiError('again', 429));
    expect(await withRetry(fn, { sleep })).toBe('ok');
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([7000, 2000]);
  });

  it.each([400, 401, 404, 413])('does not retry %i', async (status) => {
    const sleep = sleepSpy();
    const error = new ApiError('no', status);
    const fn = failing(error);
    await expect(withRetry(fn, { sleep })).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry errors that are not ApiError', async () => {
    const error = new TypeError('bug');
    const fn = failing(error);
    await expect(withRetry(fn, { sleep: sleepSpy() })).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses custom delays', async () => {
    const sleep = sleepSpy();
    const fn = failing(new ApiError('a', 503), new ApiError('b', 503));
    await expect(withRetry(fn, { sleep, delaysMs: [10] })).rejects.toThrow('b');
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([10]);
  });

  it('sleeps with real timers by default', async () => {
    vi.useFakeTimers();
    const fn = failing(new ApiError('net', 0));
    const result = withRetry(fn);
    await vi.advanceTimersByTimeAsync(999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/recording/retry.test.ts`
Expected: FAIL，`Failed to resolve import "./retry" from "src/recording/retry.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/recording/retry.ts`：

```ts
import { ApiError } from '../api/apiClient';

/** Waits before retry 1, 2 and 3. */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000];

export interface RetryOptions {
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Calls fn, retrying network errors (status 0), 5xx and 429 once per entry in delaysMs.
 * A 429 waits Retry-After when the server sent one. Everything else (401, 400, 413, other 4xx,
 * non-ApiError) is thrown straight away; after the last retry the last error is thrown.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const delays = options.delaysMs ?? RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const wait = attempt < delays.length ? retryDelay(error, delays[attempt]) : undefined;
      if (wait === undefined) throw error;
      await sleep(wait);
    }
  }
}

function retryDelay(error: unknown, fallbackMs: number): number | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.status === 429) return error.retryAfterMs ?? fallbackMs;
  if (error.status === 0 || error.status >= 500) return fallbackMs;
  return undefined;
}
```

「最多重試 3 次」= 最多呼叫 4 次（`delaysMs.length + 1`）。429 也計入次數；`Retry-After` 缺少時退回同一次的預設延遲。

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/recording/retry.test.ts`
Expected: `Tests  11 passed (11)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recording/retry.ts packages/core/src/recording/retry.test.ts
git commit -m "feat(core): retry network errors, 5xx and 429 with backoff"
```

---

### Task 9: 未轉寫標記節點 `TranscriptGap`

**Files:**
- Create: `packages/core/src/editor/transcriptGap.ts`
- Modify: `packages/core/src/editor/extensions.ts`
- Test: `packages/core/src/editor/transcriptGap.test.ts`

- [ ] **Step 1: 寫失敗的測試**

除了節點本身，也用真的 editor 產生的 JSON 驗證 M2 的三個匯出器都輸出 `[未轉寫片段]`（M2 以節點名稱辨識，這裡確認 attrs 的實際形狀不影響結果）。

`packages/core/src/editor/transcriptGap.test.ts`：

```ts
import type { JSONContent, Note } from '@oc/shared';
import { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { toHtml } from '../export/toHtml';
import { toMarkdown } from '../export/toMarkdown';
import { toTxt } from '../export/toTxt';
import { createExtensions } from './extensions';
import { gapLabel, TranscriptGap } from './transcriptGap';

const GAP_DOC: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '前' },
        { type: 'transcriptGap', attrs: { gapId: 'g1', seq: 2 } },
        { type: 'text', text: '後' },
      ],
    },
  ],
};

let editor: Editor | undefined;

function makeEditor(content: JSONContent | string = GAP_DOC) {
  editor = new Editor({ element: document.createElement('div'), extensions: createExtensions(), content });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

describe('TranscriptGap', () => {
  it('is an inline atom named transcriptGap, registered by createExtensions', () => {
    expect(TranscriptGap.name).toBe('transcriptGap');
    const type = makeEditor().schema.nodes.transcriptGap;
    expect(type.isInline).toBe(true);
    expect(type.isAtom).toBe(true);
  });

  it('renders the contract markup', () => {
    expect(gapLabel(2)).toBe('⚠ 第 2 段未轉寫・重試');
    expect(makeEditor().getHTML()).toBe(
      '<p>前<span class="oc-gap" data-transcript-gap="g1">⚠ 第 2 段未轉寫・重試</span>後</p>',
    );
  });

  it('shows the label inside the editor', () => {
    const gap = makeEditor().view.dom.querySelector('[data-transcript-gap="g1"]');
    expect(gap).toHaveTextContent('⚠ 第 2 段未轉寫・重試');
    expect(gap).toHaveClass('oc-gap');
  });

  it('keeps gapId and seq in JSON and reads them back from its HTML', () => {
    const first = makeEditor();
    const json = first.getJSON();
    expect(json).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: null },
          content: [
            { type: 'text', text: '前' },
            { type: 'transcriptGap', attrs: { gapId: 'g1', seq: 2 } },
            { type: 'text', text: '後' },
          ],
        },
      ],
    });
    const html = first.getHTML();
    first.destroy();
    expect(makeEditor(html).getJSON()).toEqual(json);
  });

  it('is plain text [未轉寫片段] for getText and every exporter', () => {
    const e = makeEditor();
    const note: Note = { id: 'n1', title: '', content: e.getJSON(), createdAt: 1, updatedAt: 1 };
    expect(e.getText()).toBe('前[未轉寫片段]後');
    expect(toTxt(note)).toBe('前[未轉寫片段]後');
    expect(toMarkdown(note)).toBe('前\\[未轉寫片段\\]後\n');
    expect(toHtml(note)).toBe('<p>前[未轉寫片段]後</p>');
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/editor/transcriptGap.test.ts`
Expected: FAIL，`Failed to resolve import "./transcriptGap" from "src/editor/transcriptGap.test.ts". Does the file exist?`

- [ ] **Step 3: 實作節點**

`packages/core/src/editor/transcriptGap.ts`：

```ts
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
```

`Node` 與 `mergeAttributes` 從 `@tiptap/react` 匯入（它 `export * from '@tiptap/core'`，與 M1／M2 取 `Extensions`、`generateHTML` 的做法一致）；改名為 `TiptapNode` 以免遮蔽 DOM 的全域 `Node` 型別。`mergeAttributes({ class: 'oc-gap' }, HTMLAttributes)` 讓 `class` 排在 `data-transcript-gap` 前面，`getHTML()` 與契約逐字相同。

- [ ] **Step 4: 加入 `createExtensions`**

`packages/core/src/editor/extensions.ts` 完整內容（相對 M1 只多了 import 與陣列最後的 `TranscriptGap`）：

```ts
import type { Extensions } from '@tiptap/react';
import { Highlight } from '@tiptap/extension-highlight';
import { TextAlign } from '@tiptap/extension-text-align';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import { Placeholder } from '@tiptap/extensions';
import { StarterKit } from '@tiptap/starter-kit';
import { TranscriptGap } from './transcriptGap';

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
    TranscriptGap,
  ];
}
```

M2 的 `toHtml` 在呼叫 `generateHTML` 前就把 `transcriptGap` 換成 `[未轉寫片段]`，所以加入節點後剪貼簿與 PDF 仍不會出現「⚠ 第 N 段未轉寫・重試」。

- [ ] **Step 5: 執行測試，確認通過（含編輯器與匯出的既有測試）**

Run: `npm test -w @oc/core -- src/editor src/export`
Expected: `Test Files  17 passed (17)`、`Tests  124 passed (124)`（其中 `transcriptGap.test.ts` 5 個）。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/editor/transcriptGap.ts packages/core/src/editor/transcriptGap.test.ts packages/core/src/editor/extensions.ts
git commit -m "feat(core): add transcript gap node to the editor"
```

---

### Task 10: 插入器 `TranscriptInserter`

**Files:**
- Create: `packages/core/src/recording/transcriptInserter.ts`
- Test: `packages/core/src/recording/transcriptInserter.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`<p>AB</p>` 的位置：1 在 A 前、2 在 A 與 B 之間、3 在 B 後。

`packages/core/src/recording/transcriptInserter.test.ts`：

```ts
import { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createExtensions } from '../editor/extensions';
import { TranscriptInserter } from './transcriptInserter';

let editor: Editor | undefined;

function makeEditor(html = '<p>AB</p>') {
  editor = new Editor({ element: document.createElement('div'), extensions: createExtensions(), content: html });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

describe('TranscriptInserter', () => {
  it('inserts consecutive transcripts one after another at the anchor', () => {
    const e = makeEditor();
    const inserter = new TranscriptInserter(e, 2); // between A and B
    inserter.insertText('一');
    inserter.insertText('二');
    expect(e.getText()).toBe('A一二B');
    expect(inserter.position).toBe(4);
  });

  it('follows the anchor when the user types before it', () => {
    const e = makeEditor();
    const inserter = new TranscriptInserter(e, 2);
    inserter.insertText('一');
    e.commands.insertContentAt(1, 'XY');
    inserter.insertText('二');
    expect(e.getText()).toBe('XYA一二B');
  });

  it('is not moved by typing after it', () => {
    const e = makeEditor();
    const inserter = new TranscriptInserter(e, 2);
    e.commands.insertContentAt(3, 'Z'); // after B
    inserter.insertText('一');
    expect(e.getText()).toBe('A一BZ');
  });

  it('does not move the user’s cursor', () => {
    const e = makeEditor();
    e.commands.setTextSelection(3); // after B
    const inserter = new TranscriptInserter(e, 1); // before A
    inserter.insertText('一二');
    expect(e.getText()).toBe('一二AB');
    expect(e.state.selection.from).toBe(5); // still after B
  });

  it('inserts plain text even inside bold text', () => {
    const e = makeEditor('<p><strong>AB</strong></p>');
    new TranscriptInserter(e, 2).insertText('一');
    expect(e.getHTML()).toBe('<p><strong>A</strong>一<strong>B</strong></p>');
  });

  it('inserts a gap marker in order with the text', () => {
    const e = makeEditor('<p></p>');
    const inserter = new TranscriptInserter(e, 1);
    inserter.insertText('一');
    inserter.insertGap('g2', 2);
    inserter.insertText('三');
    expect(e.getHTML()).toBe(
      '<p>一<span class="oc-gap" data-transcript-gap="g2">⚠ 第 2 段未轉寫・重試</span>三</p>',
    );
  });

  it('moves an anchor outside any paragraph to the nearest text position', () => {
    const e = makeEditor('<p>A</p><p>B</p>');
    const inserter = new TranscriptInserter(e, e.state.doc.content.size); // after the last paragraph
    inserter.insertText('一');
    expect(e.getHTML()).toBe('<p>A</p><p>B一</p>');
  });

  it('ignores empty text and stops after destroy()', () => {
    const e = makeEditor();
    const inserter = new TranscriptInserter(e, 2);
    inserter.insertText('');
    inserter.destroy();
    inserter.insertText('一');
    inserter.insertGap('g1', 1);
    expect(e.getText()).toBe('AB');
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/recording/transcriptInserter.test.ts`
Expected: FAIL，`Failed to resolve import "./transcriptInserter" from "src/recording/transcriptInserter.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/recording/transcriptInserter.ts`：

```ts
import type { Node as PmNode } from '@tiptap/pm/model';
import { Selection, type Transaction } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import { TRANSCRIPT_GAP_TYPE } from '../export/common';

/**
 * Inserts transcripts at the position the cursor had when recording started. The position is
 * mapped through every document change, so typing elsewhere while recording never shifts it, and
 * the user's own selection is left alone.
 */
export class TranscriptInserter {
  private pos: number;
  private destroyed = false;

  constructor(
    private readonly editor: Editor,
    anchorPos: number,
  ) {
    this.pos = textPosition(editor, anchorPos);
    editor.on('transaction', this.onTransaction);
  }

  get position(): number {
    return this.pos;
  }

  insertText(text: string): void {
    if (text === '') return;
    // schema.text() carries no marks, so a transcript is plain even inside bold text.
    this.insert(this.editor.schema.text(text));
  }

  insertGap(gapId: string, seq: number): void {
    this.insert(this.editor.schema.nodes[TRANSCRIPT_GAP_TYPE].create({ gapId, seq }));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.editor.off('transaction', this.onTransaction);
  }

  private readonly onTransaction = ({
    transaction,
    appendedTransactions = [],
  }: {
    transaction: Transaction;
    appendedTransactions?: Transaction[];
  }) => {
    // assoc = 1: content inserted exactly at the anchor ends up before it, so our own
    // insertions (and the user typing at the same spot) push the anchor forward.
    for (const tr of [transaction, ...appendedTransactions]) {
      if (tr.docChanged) this.pos = tr.mapping.map(this.pos, 1);
    }
  };

  private insert(node: PmNode): void {
    if (this.destroyed || this.editor.isDestroyed) return;
    const { state, view } = this.editor;
    view.dispatch(state.tr.insert(this.pos, node));
  }
}

/** Clamps pos into the document and moves it into a textblock (e.g. after a select-all). */
function textPosition(editor: Editor, pos: number): number {
  const { doc } = editor.state;
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  return $pos.parent.inlineContent ? $pos.pos : Selection.near($pos, -1).from;
}
```

依據 `@tiptap/core` 3.32 原始碼：`dispatchTransaction` 套用交易後以 `emit('transaction', { editor, transaction, appendedTransactions })` 通知，`appendedTransactions` 是 plugin 的 `appendTransaction` 附加的交易（例如 StarterKit 的 TrailingNode 在文件結尾補空段落），所以兩者都要 map。插入本身也是一個交易：在錨點插入的內容以 `assoc = 1` map 後落在錨點之前，因此錨點自動移到剛插入的文字之後，連續插入會依序接在一起。`editor.view.dispatch` 在 editor 尚未掛載時也可用（v3 的 view getter 會回傳可 dispatch 的代理物件）。

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/recording/transcriptInserter.test.ts`
Expected: `Tests  8 passed (8)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recording/transcriptInserter.ts packages/core/src/recording/transcriptInserter.test.ts
git commit -m "feat(core): insert transcripts at a position mapped through edits"
```

---

### Task 11: 取代標記 `replaceGap`

**Files:**
- Create: `packages/core/src/recording/replaceGap.ts`
- Test: `packages/core/src/recording/replaceGap.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`packages/core/src/recording/replaceGap.test.ts`：

```ts
import type { JSONContent } from '@oc/shared';
import { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createExtensions } from '../editor/extensions';
import { replaceGap } from './replaceGap';

const gap = (gapId: string, seq: number): JSONContent => ({ type: 'transcriptGap', attrs: { gapId, seq } });
const text = (value: string): JSONContent => ({ type: 'text', text: value });

let editor: Editor | undefined;

function makeEditor(...inline: JSONContent[]) {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createExtensions(),
    content: { type: 'doc', content: [{ type: 'paragraph', content: inline }] },
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

describe('replaceGap', () => {
  it('replaces the matching gap with the transcript', () => {
    const e = makeEditor(text('前'), gap('g1', 1), text('中'), gap('g2', 2), text('後'));
    expect(replaceGap(e, 'g2', '第二段')).toBe(true);
    expect(e.getText()).toBe('前[未轉寫片段]中第二段後');
    expect(e.getHTML()).toContain('data-transcript-gap="g1"');
    expect(e.getHTML()).not.toContain('data-transcript-gap="g2"');
  });

  it('removes the gap when the transcript is empty', () => {
    const e = makeEditor(text('前'), gap('g1', 1), text('後'));
    expect(replaceGap(e, 'g1', '')).toBe(true);
    expect(e.getHTML()).toBe('<p>前後</p>');
  });

  it('returns false when the gap is not in the document', () => {
    const e = makeEditor(text('前'), gap('g1', 1));
    expect(replaceGap(e, 'missing', '文字')).toBe(false);
    expect(e.getText()).toBe('前[未轉寫片段]');
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/recording/replaceGap.test.ts`
Expected: FAIL，`Failed to resolve import "./replaceGap" from "src/recording/replaceGap.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/recording/replaceGap.ts`：

```ts
import type { Editor } from '@tiptap/react';
import { TRANSCRIPT_GAP_TYPE } from '../export/common';

/**
 * Replaces the transcriptGap node with this gapId by `text` (or removes it when text is empty).
 * Returns false when the document has no such gap.
 */
export function replaceGap(editor: Editor, gapId: string, text: string): boolean {
  if (editor.isDestroyed) return false;
  let range: { from: number; to: number } | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (range) return false;
    if (node.type.name === TRANSCRIPT_GAP_TYPE && node.attrs.gapId === gapId) {
      range = { from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  if (!range) return false;
  const tr = editor.state.tr;
  if (text) tr.replaceWith(range.from, range.to, editor.schema.text(text));
  else tr.delete(range.from, range.to);
  editor.view.dispatch(tr);
  return true;
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/core -- src/recording/replaceGap.test.ts`
Expected: `Tests  3 passed (3)`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recording/replaceGap.ts packages/core/src/recording/replaceGap.test.ts
git commit -m "feat(core): replace a transcript gap with its retried text"
```

---

### Task 12: 未轉寫音訊佇列 `pendingQueue`

**Files:**
- Create: `packages/core/src/recording/pendingQueue.ts`
- Test: `packages/core/src/recording/pendingQueue.test.ts`

- [ ] **Step 1: 寫失敗的測試**

fake-indexeddb 以 Node 的 `structuredClone` 複製資料，jsdom 的 `Blob` 會變成 `{}`；Node 內建的 `Blob`（`node:buffer`）則能完整存回，所以這裡用它代替瀏覽器的 Blob（`@types/node` 已由 M1 安裝在根目錄）。真實瀏覽器中 Blob 的保存由 Task 15 的 e2e「重新整理後點擊標記補上」驗證。

`packages/core/src/recording/pendingQueue.test.ts`：

```ts
import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { openAppDb } from '../platform/db';
import { createPendingQueue, type PendingSegment } from './pendingQueue';

/**
 * fake-indexeddb clones values with Node's structuredClone, which turns jsdom's Blob into a plain
 * object. Node's own Blob survives the clone, so it stands in for the browser Blob here.
 */
const segment = (gapId: string, seq = 1): PendingSegment => ({
  gapId,
  noteId: 'n1',
  seq,
  blob: new NodeBlob(['audio-bytes'], { type: 'audio/webm' }) as unknown as Blob,
  mimeType: 'audio/webm',
  prompt: '前一段',
});

const newDb = () => openAppDb(`test-${crypto.randomUUID()}`);

describe('createPendingQueue', () => {
  it('stores a failed segment, audio included, under its gapId', async () => {
    const queue = createPendingQueue(await newDb());
    await queue.add(segment('g1', 3));

    const stored = await queue.get('g1');
    expect(stored).toMatchObject({ gapId: 'g1', noteId: 'n1', seq: 3, mimeType: 'audio/webm', prompt: '前一段' });
    const blob = stored?.blob as unknown as NodeBlob;
    expect(blob.type).toBe('audio/webm');
    expect(await blob.text()).toBe('audio-bytes');
  });

  it('returns undefined for an unknown gap and removes entries', async () => {
    const queue = createPendingQueue(await newDb());
    await queue.add(segment('g1'));
    await queue.add(segment('g2', 2));
    expect(await queue.get('nope')).toBeUndefined();

    await queue.remove('g1');

    expect(await queue.get('g1')).toBeUndefined();
    expect((await queue.get('g2'))?.seq).toBe(2);
  });

  it('also accepts the promise returned by openAppDb()', async () => {
    const queue = createPendingQueue(newDb());
    await queue.add(segment('g1'));
    expect((await queue.get('g1'))?.gapId).toBe('g1');
  });

  it('removeByNote drops every segment of a deleted note and keeps the others', async () => {
    const queue = createPendingQueue(await newDb());
    await queue.add(segment('g1', 1));
    await queue.add(segment('g2', 2));
    await queue.add({ ...segment('g3', 1), noteId: 'n2' });

    await queue.removeByNote('n1');

    expect(await queue.get('g1')).toBeUndefined();
    expect(await queue.get('g2')).toBeUndefined();
    expect((await queue.get('g3'))?.noteId).toBe('n2');
    await expect(queue.removeByNote('no-such-note')).resolves.toBeUndefined();
    expect(await queue.get('g3')).toBeDefined();
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/recording/pendingQueue.test.ts`
Expected: FAIL，`Failed to resolve import "./pendingQueue" from "src/recording/pendingQueue.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`packages/core/src/recording/pendingQueue.ts`：

```ts
import type { IDBPDatabase } from 'idb';
import type { AppDbSchema, PendingSegmentRecord } from '../platform/db';

/** Audio of a segment that is still untranscribed, kept until a retry succeeds. */
export type PendingSegment = PendingSegmentRecord;

/** The app database, or the promise openAppDb() returned. */
export type AppDbHandle = IDBPDatabase<AppDbSchema> | Promise<IDBPDatabase<AppDbSchema>>;

export interface PendingQueue {
  add(item: PendingSegment): Promise<void>;
  get(gapId: string): Promise<PendingSegment | undefined>;
  remove(gapId: string): Promise<void>;
  /** Drops the audio of every gap in a note that was deleted (its markers can never be retried). */
  removeByNote(noteId: string): Promise<void>;
}

/** The `pendingSegments` store (keyPath `gapId`) as a small queue API. */
export function createPendingQueue(db: AppDbHandle): PendingQueue {
  return {
    async add(item) {
      const conn = await db;
      const tx = conn.transaction('pendingSegments', 'readwrite');
      const request = tx.store.put(item);
      // Commit explicitly, like NoteStorage.put: the write may happen while the page is closing.
      tx.commit();
      await Promise.all([request, tx.done]);
    },
    async get(gapId) {
      return (await db).get('pendingSegments', gapId);
    },
    async remove(gapId) {
      await (await db).delete('pendingSegments', gapId);
    },
    async removeByNote(noteId) {
      const conn = await db;
      const tx = conn.transaction('pendingSegments', 'readwrite');
      // No noteId index (the M1 schema stays at version 1); the store only ever holds a few rows.
      const rows = await tx.store.getAll();
      const deletes = rows.filter((row) => row.noteId === noteId).map((row) => tx.store.delete(row.gapId));
      await Promise.all([...deletes, tx.done]);
    },
  };
}
```

`PendingSegment` 直接沿用 M1 `db.ts` 的 `PendingSegmentRecord`（欄位與契約相同）。`add` 比照 M1 `createIndexedDbStorage().put`：明確 `tx.commit()`，並同時等待請求與交易，失敗只 reject 一次。`removeByNote` 在同一個 readwrite 交易內讀出全部列再刪除相符者：idb 的請求 promise 在 success 事件中 resolve，`await tx.store.getAll()` 之後交易仍在作用中；沒有相符的列時只等 `tx.done`。

- [ ] **Step 4: 執行測試與型別檢查，確認通過**

Run: `npm test -w @oc/core -- src/recording/pendingQueue.test.ts && npm run typecheck -w @oc/core`
Expected: `Tests  4 passed (4)`；typecheck 無錯誤。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recording/pendingQueue.ts packages/core/src/recording/pendingQueue.test.ts
git commit -m "feat(core): keep untranscribed audio in the pendingSegments store"
```

---

### Task 13: `useRecorder`（一）：開始、依序插入、停止

**Files:**
- Create: `packages/core/src/test/recorderHarness.ts`
- Create: `packages/core/src/recording/useRecorder.ts`
- Test: `packages/core/src/recording/useRecorder.test.ts`

本 Task 先完成成功路徑：未設定時為 `needsSetup`、取得麥克風、每段上傳（含重試）、依 `seq` 插入、空字串略過、prompt 為已插入文字的最後 200 字、停止時等所有上傳結束並釋放麥克風、麥克風被拒、權限詢問期間切換筆記則放棄開始、卸載時釋放麥克風。重試後仍失敗的片段暫時只記錄錯誤並略過（不卡住後面的片段）；Task 14 再把它改成未轉寫標記並加上重送、401、413 與中斷提示。選項型別（`db`、`onUnauthorized`、`deps.newGapId`）在本 Task 就定案，Task 14 才開始使用它們，測試輔助因此兩個 Task 共用、不必修改。

- [ ] **Step 1: 建立 `useRecorder` 的測試輔助（Task 13、14 共用）**

`setupRecorder()` 用真的 Tiptap editor（含 `TranscriptGap`）與每個測試獨立的 fake-indexeddb 資料庫渲染 `useRecorder`，所有外部依賴都以 `deps` 換成假的：`FakeSegmentRecorder` 讓測試手動送出片段，`createFakeClient()` 的 `transcribe` 會等測試呼叫 `resolve`／`reject`（也可用 `mockImplementation` 自動回應），`sleep` 立即完成（重試不必真的等 1s→2s→4s）。editor 由 `createTestEditor()` 建立、Vitest 的 `onTestFinished` 銷毀（測試自己先銷毀也沒關係）。hook 的 props 是 `{ settings, editor?, noteId? }`：`rerender({ settings, editor: createTestEditor(), noteId: 'n2' })` 模擬 `NotesApp` 切換筆記時換上新的 editor；省略 `editor`／`noteId` 時用原本的 editor 與 `'n1'`。

`packages/core/src/test/recorderHarness.ts`：

```ts
import type { TranscribeResponse } from '@oc/shared';
import { act, renderHook } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import { onTestFinished, vi } from 'vitest';
import type { ApiClient, TranscribeInput } from '../api/apiClient';
import { createExtensions } from '../editor/extensions';
import { openAppDb } from '../platform/db';
import type { SegmentRecorderOptions } from '../recording/segmentRecorder';
import {
  useRecorder,
  type RecorderDeps,
  type SegmentRecorderHandle,
} from '../recording/useRecorder';
import type { Settings } from '../settings/settingsStore';
import { createFakeStream } from './media';

export const CONFIGURED: Settings = { apiBaseUrl: 'https://api.test', accessKey: 'key-1' };

/** Stands in for SegmentRecorder; tests push segments through it by hand. */
export class FakeSegmentRecorder implements SegmentRecorderHandle {
  started = false;
  /** Runs inside stop(), e.g. to deliver the last segment like the real recorder does. */
  onStop: (() => void) | undefined;
  readonly stop = vi.fn(async () => {
    this.onStop?.();
  });

  constructor(readonly options: SegmentRecorderOptions) {}

  start(): void {
    this.started = true;
  }

  emit(seq: number): void {
    this.options.onSegment({ seq, blob: new Blob([`audio-${seq}`], { type: 'audio/webm;codecs=opus' }) });
  }

  interrupt(): void {
    this.options.onInterrupted();
  }
}

export interface PendingCall {
  input: TranscribeInput;
  resolve(text: string): void;
  reject(error: unknown): void;
}

/** An ApiClient whose transcribe() calls wait until the test resolves or rejects them. */
export function createFakeClient() {
  const calls: PendingCall[] = [];
  const transcribe = vi.fn(
    (input: TranscribeInput) =>
      new Promise<TranscribeResponse>((resolve, reject) => {
        calls.push({ input, resolve: (text) => resolve({ seq: input.seq, text }), reject });
      }),
  );
  const client: ApiClient = { health: vi.fn(async () => true), transcribe };
  return { client, transcribe, calls };
}

/** Lets pending promise chains (upload → insert) run, inside act(). */
export const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** A real editor with the app's extensions (TranscriptGap included), destroyed when the test ends. */
export function createTestEditor(content = '<p></p>'): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: createExtensions(),
    content,
  });
  onTestFinished(() => {
    // A test may already have destroyed it, e.g. to act out switching to another note.
    if (!editor.isDestroyed) editor.destroy();
  });
  return editor;
}

/** Props of the rendered hook; `rerender` takes the same shape. */
export interface RecorderProps {
  settings: Settings;
  /** Defaults to the editor setupRecorder created; NotesApp passes a new editor per note. */
  editor?: Editor;
  /** Defaults to 'n1'. */
  noteId?: string;
}

/**
 * Renders useRecorder against a real editor and a fresh fake IndexedDB, with every outside
 * dependency replaced by a fake. `rerender({ settings, editor?, noteId? })` changes the props,
 * e.g. a new editor and noteId when the user opens another note.
 */
export async function setupRecorder(options: { settings?: Settings; content?: string } = {}) {
  const editor = createTestEditor(options.content);
  const db = await openAppDb(`test-${crypto.randomUUID()}`);
  const media = createFakeStream();
  const recorders: FakeSegmentRecorder[] = [];
  const fake = createFakeClient();
  let gaps = 0;
  const deps = {
    getUserMedia: vi.fn(async () => media.stream),
    createRecorder: vi.fn((recorderOptions: SegmentRecorderOptions) => {
      const recorder = new FakeSegmentRecorder(recorderOptions);
      recorders.push(recorder);
      return recorder;
    }),
    createClient: vi.fn((_settings: Settings) => fake.client),
    pickMimeType: () => 'audio/webm;codecs=opus',
    sleep: vi.fn(async (_ms: number) => undefined),
    newGapId: () => `gap-${++gaps}`,
  } satisfies RecorderDeps;
  const onUnauthorized = vi.fn();
  // Typed as RecorderProps so that rerender() accepts editor and noteId too.
  const initialProps: RecorderProps = { settings: options.settings ?? CONFIGURED };
  const hook = renderHook(
    ({ settings, editor: current = editor, noteId = 'n1' }: RecorderProps) =>
      useRecorder({ editor: current, noteId, settings, db, onUnauthorized, deps }),
    { initialProps },
  );
  return {
    ...hook,
    editor,
    db,
    deps,
    recorders,
    onUnauthorized,
    stream: media.stream,
    track: media.track,
    ...fake,
  };
}
```

- [ ] **Step 2: 寫失敗的測試**

`packages/core/src/recording/useRecorder.test.ts`：

```ts
import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CONFIGURED, createTestEditor, settle, setupRecorder } from '../test/recorderHarness';
import { RECORDER_MESSAGES } from './useRecorder';

describe('useRecorder: recording', () => {
  it('needs setup until both a backend URL and an access key are saved', async () => {
    const { result, rerender, deps } = await setupRecorder({ settings: { apiBaseUrl: 'https://api.test', accessKey: '' } });
    expect(result.current.state).toBe('needsSetup');

    await act(async () => {
      await result.current.start();
    });
    expect(deps.getUserMedia).not.toHaveBeenCalled();

    rerender({ settings: CONFIGURED });
    expect(result.current.state).toBe('idle');
  });

  it('records from the cursor and inserts transcripts in recording order', async () => {
    const { result, editor, recorders, calls, deps } = await setupRecorder({ content: '<p>開頭結尾</p>' });
    act(() => {
      editor.commands.setTextSelection(3); // between 開頭 and 結尾
    });

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe('recording');
    expect(deps.createClient).toHaveBeenCalledWith(CONFIGURED);
    expect(recorders[0].started).toBe(true);
    expect(recorders[0].options.mimeType).toBe('audio/webm;codecs=opus');

    act(() => {
      recorders[0].emit(1);
      recorders[0].emit(2);
    });
    expect(calls.map((c) => [c.input.seq, c.input.filename])).toEqual([
      [1, 'segment-1.webm'],
      [2, 'segment-2.webm'],
    ]);

    calls[1].resolve('第二段。');
    await settle();
    expect(editor.getText()).toBe('開頭結尾'); // segment 2 waits for segment 1

    calls[0].resolve('第一段。');
    await settle();
    expect(editor.getText()).toBe('開頭第一段。第二段。結尾');
  });

  it('keeps inserting at its own spot while the user types elsewhere', async () => {
    const { result, editor, recorders, calls } = await setupRecorder({ content: '<p>AB</p>' });
    act(() => {
      editor.commands.setTextSelection(2);
    });
    await act(async () => {
      await result.current.start();
    });
    act(() => recorders[0].emit(1));
    act(() => {
      editor.commands.insertContentAt(1, '使用者');
    });

    calls[0].resolve('轉寫');
    await settle();

    expect(editor.getText()).toBe('使用者A轉寫B');
  });

  it('sends the last 200 characters it inserted as the prompt', async () => {
    const { result, recorders, calls } = await setupRecorder();
    await act(async () => {
      await result.current.start();
    });
    act(() => recorders[0].emit(1));
    expect(calls[0].input.prompt).toBe('');

    calls[0].resolve(`${'甲'.repeat(150)}${'乙'.repeat(100)}`);
    await settle();
    act(() => recorders[0].emit(2));

    expect(calls[1].input.prompt).toBe(`${'甲'.repeat(100)}${'乙'.repeat(100)}`);
  });

  it('skips empty transcripts without holding up later segments', async () => {
    const { result, editor, recorders, calls } = await setupRecorder();
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      recorders[0].emit(1);
      recorders[0].emit(2);
    });

    calls[0].resolve('  ');
    calls[1].resolve('有內容');
    await settle();

    expect(editor.getText()).toBe('有內容');
  });

  it('stop() delivers the last segment, waits for every upload, then releases the microphone', async () => {
    const { result, editor, recorders, calls, track } = await setupRecorder();
    await act(async () => {
      await result.current.start();
    });
    act(() => recorders[0].emit(1));
    recorders[0].onStop = () => recorders[0].emit(2);

    let stopped!: Promise<void>;
    act(() => {
      stopped = result.current.stop();
    });
    expect(result.current.state).toBe('stopping');
    await settle();
    expect(recorders[0].stop).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalled();
    expect(calls).toHaveLength(2);

    await act(async () => {
      calls[0].resolve('一');
      calls[1].resolve('二');
      await stopped;
    });

    expect(result.current.state).toBe('idle');
    expect(editor.getText()).toBe('一二');
  });

  it('reports a denied microphone and stays idle', async () => {
    const { result, deps, recorders } = await setupRecorder();
    deps.getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBe('無法使用麥克風，請在系統或瀏覽器設定中允許麥克風權限');
    expect(RECORDER_MESSAGES.micDenied).toBe(result.current.error);
    expect(recorders).toHaveLength(0);
  });

  it('gives the microphone back when another note is opened while the permission prompt is up', async () => {
    const { result, rerender, deps, recorders, stream, track } = await setupRecorder();
    let grant!: () => void;
    deps.getUserMedia.mockImplementationOnce(
      () =>
        new Promise<MediaStream>((resolve) => {
          grant = () => resolve(stream);
        }),
    );

    let started!: Promise<void>;
    act(() => {
      started = result.current.start();
    });
    // The prompt does not block the page: the note list is still usable and NotesApp hands the
    // hook the new note's editor (useNoteEditor destroys the old one).
    rerender({ settings: CONFIGURED, editor: createTestEditor(), noteId: 'n2' });
    await act(async () => {
      grant();
      await started;
    });

    expect(result.current.state).toBe('idle');
    expect(track.stop).toHaveBeenCalled();
    expect(recorders).toHaveLength(0);
    expect(deps.createClient).not.toHaveBeenCalled();
  });

  it('releases the microphone when the component unmounts mid-recording', async () => {
    const { result, recorders, track, unmount } = await setupRecorder();
    await act(async () => {
      await result.current.start();
    });

    unmount();

    expect(recorders[0].stop).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/recording/useRecorder.test.ts`
Expected: FAIL，`Failed to resolve import "./useRecorder" from "src/recording/useRecorder.test.ts". Does the file exist?`

- [ ] **Step 4: 實作**

`packages/core/src/recording/useRecorder.ts`：

```ts
import type { Editor } from '@tiptap/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createApiClient, type ApiClient } from '../api/apiClient';
import { isConfigured, type Settings } from '../settings/settingsStore';
import { OrderedBuffer } from './orderedBuffer';
import type { AppDbHandle } from './pendingQueue';
import { extensionFor, pickMimeType } from './pickMimeType';
import { withRetry } from './retry';
import { SegmentRecorder, type RecordedSegment, type SegmentRecorderOptions } from './segmentRecorder';
import { TranscriptInserter } from './transcriptInserter';

export type RecorderState = 'idle' | 'needsSetup' | 'recording' | 'stopping';

export const RECORDER_MESSAGES = {
  micDenied: '無法使用麥克風，請在系統或瀏覽器設定中允許麥克風權限',
  startFailed: '無法開始錄音，請再試一次',
} as const;

/** How much of the text already inserted in this recording is sent as the prompt. */
export const PROMPT_CHARS = 200;

export interface SegmentRecorderHandle {
  start(): void;
  stop(): Promise<void>;
}

/** Everything useRecorder touches outside React; tests replace these. */
export interface RecorderDeps {
  getUserMedia(): Promise<MediaStream>;
  createRecorder(options: SegmentRecorderOptions): SegmentRecorderHandle;
  createClient(settings: Settings): ApiClient;
  pickMimeType(): string | undefined;
  /** Wait between retries. */
  sleep(ms: number): Promise<void>;
  newGapId(): string;
}

export const defaultRecorderDeps: RecorderDeps = {
  getUserMedia: () => {
    const media = globalThis.navigator?.mediaDevices;
    if (!media?.getUserMedia) return Promise.reject(new Error('getUserMedia is not available'));
    return media.getUserMedia({ audio: true });
  },
  createRecorder: (options) => new SegmentRecorder(options),
  createClient: (settings) =>
    createApiClient({ baseUrl: settings.apiBaseUrl, accessKey: settings.accessKey }),
  pickMimeType: () => pickMimeType(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  newGapId: () => crypto.randomUUID(),
};

export interface UseRecorderOptions {
  /** The editor transcripts go into (NotesApp's useNoteEditor editor). */
  editor: Editor;
  /** Active note; recording cannot start while it is undefined (notes still loading). */
  noteId: string | undefined;
  settings: Settings;
  /** App database (or openAppDb()'s promise) holding untranscribed audio. */
  db: AppDbHandle;
  /** The access key was rejected (401); NotesApp opens the settings dialog. */
  onUnauthorized?(): void;
  deps?: Partial<RecorderDeps>;
}

export interface UseRecorderResult {
  state: RecorderState;
  error: string | null;
  notice: string | null;
  start(): Promise<void>;
  stop(): Promise<void>;
}

type Phase = 'idle' | 'recording' | 'stopping';

type SegmentResult = { kind: 'text'; text: string } | { kind: 'skip' };

interface Session {
  noteId: string;
  client: ApiClient;
  stream: MediaStream;
  recorder: SegmentRecorderHandle;
  inserter: TranscriptInserter;
  buffer: OrderedBuffer<SegmentResult>;
  mimeType: string | undefined;
  /** Text inserted by this recording so far; its tail is the next prompt. */
  transcript: string;
  uploads: Set<Promise<void>>;
  finishing: Promise<void> | null;
}

interface ControllerEnv {
  options(): UseRecorderOptions;
  setPhase(phase: Phase): void;
  setError(message: string | null): void;
  setNotice(message: string | null): void;
}

/**
 * Records with the microphone, uploads every segment as soon as it is cut (in parallel, with
 * retries) and inserts the transcripts strictly in recording order at the cursor position the
 * recording started from.
 */
export function useRecorder(options: UseRecorderOptions): UseRecorderResult {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const latest = useRef({ options });
  useLayoutEffect(() => {
    latest.current = { options };
  });

  const controllerRef = useRef<ReturnType<typeof createRecorderController> | null>(null);
  controllerRef.current ??= createRecorderController({
    options: () => latest.current.options,
    setPhase,
    setError,
    setNotice,
  });
  const controller = controllerRef.current;

  useEffect(() => () => controller.dispose(), [controller]);

  const state: RecorderState =
    phase !== 'idle' ? phase : isConfigured(options.settings) ? 'idle' : 'needsSetup';

  return { state, error, notice, start: controller.start, stop: controller.stop };
}

function createRecorderController(env: ControllerEnv) {
  let session: Session | null = null;
  let starting = false;

  const deps = (): RecorderDeps => ({ ...defaultRecorderDeps, ...env.options().deps });

  async function start(): Promise<void> {
    const { editor, noteId, settings } = env.options();
    if (session || starting || !noteId || !isConfigured(settings)) return;
    starting = true;
    try {
      const d = deps();
      env.setError(null);
      env.setNotice(null);
      let stream: MediaStream;
      try {
        stream = await d.getUserMedia();
      } catch {
        env.setError(RECORDER_MESSAGES.micDenied);
        return;
      }
      // The permission prompt does not block the page, so the user may have opened another note
      // (useNoteEditor then destroys this editor) or changed the settings meanwhile. Only record
      // into the note that is still on screen.
      const now = env.options();
      if (
        now.noteId !== noteId ||
        now.editor !== editor ||
        editor.isDestroyed ||
        !isConfigured(now.settings)
      ) {
        stopTracks(stream);
        return;
      }
      const mimeType = d.pickMimeType();
      // Assigned right below, before the recorder can call back.
      let current: Session;
      const recorder = d.createRecorder({
        stream,
        mimeType,
        onSegment: (segment) => handleSegment(current, segment),
        onInterrupted: () => void finish(current),
      });
      current = {
        noteId,
        client: d.createClient(now.settings),
        stream,
        recorder,
        inserter: new TranscriptInserter(editor, editor.state.selection.to),
        buffer: new OrderedBuffer<SegmentResult>(),
        mimeType,
        transcript: '',
        uploads: new Set(),
        finishing: null,
      };
      try {
        recorder.start();
      } catch (error) {
        console.error('Failed to start recording', error);
        stopTracks(stream);
        current.inserter.destroy();
        env.setError(RECORDER_MESSAGES.startFailed);
        return;
      }
      session = current;
      env.setPhase('recording');
    } finally {
      starting = false;
    }
  }

  async function stop(): Promise<void> {
    if (session) await finish(session);
  }

  function finish(current: Session): Promise<void> {
    current.finishing ??= (async () => {
      env.setPhase('stopping');
      // Delivers the last segment through onSegment before it resolves.
      await current.recorder
        .stop()
        .catch((error: unknown) => console.error('Failed to stop recording', error));
      stopTracks(current.stream);
      while (current.uploads.size > 0) await Promise.allSettled([...current.uploads]);
      current.inserter.destroy();
      if (session === current) session = null;
      env.setPhase('idle');
    })();
    return current.finishing;
  }

  function handleSegment(current: Session, { seq, blob }: RecordedSegment): void {
    const prompt = tail(current.transcript, PROMPT_CHARS);
    const mimeType = blob.type || current.mimeType || '';
    const upload: Promise<void> = transcribeSegment(current, seq, blob, mimeType, prompt)
      .then((result) => release(current, seq, result))
      .catch((error: unknown) => console.error(`Failed to handle segment ${seq}`, error))
      .finally(() => {
        current.uploads.delete(upload);
      });
    current.uploads.add(upload);
  }

  async function transcribeSegment(
    current: Session,
    seq: number,
    blob: Blob,
    mimeType: string,
    prompt: string,
  ): Promise<SegmentResult> {
    const d = deps();
    try {
      const response = await withRetry(
        () =>
          current.client.transcribe({
            audio: blob,
            seq,
            prompt,
            filename: `segment-${seq}.${extensionFor(mimeType)}`,
          }),
        { sleep: d.sleep },
      );
      return response.text.trim() === '' ? { kind: 'skip' } : { kind: 'text', text: response.text };
    } catch (error) {
      // Dropped so that later segments are not held up.
      console.error(`Segment ${seq} could not be transcribed`, error);
      return { kind: 'skip' };
    }
  }

  /** Inserts every result that is now next in line. */
  function release(current: Session, seq: number, result: SegmentResult): void {
    for (const item of current.buffer.put(seq, result)) {
      if (item.kind === 'text') {
        current.inserter.insertText(item.text);
        current.transcript += item.text;
      }
    }
  }

  /** Unmount: stop the microphone; uploads still finish but insert nothing. */
  function dispose(): void {
    const current = session;
    if (!current) return;
    session = null;
    current.inserter.destroy();
    void current.recorder.stop().catch(() => undefined);
    stopTracks(current.stream);
  }

  return { start, stop, dispose };
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** The last `count` characters (code points) of text. */
function tail(text: string, count: number): string {
  const chars = Array.from(text);
  return chars.length <= count ? text : chars.slice(-count).join('');
}
```

設計重點：
- 錄音狀態放在一個只建立一次的 controller（`createRecorderController`）裡，hook 只持有三個 React state（階段、錯誤、提示）。controller 透過 `latest` ref 讀最新的 props（`useLayoutEffect` 每次 render 後更新），所以 `start`／`stop` 是穩定的函式，而且永遠用到最新的 editor 與設定。
- `getUserMedia` 等待權限期間階段仍是 `idle`，筆記清單可用；回來後重新讀選項，`noteId`／`editor` 換了、editor 已銷毀或設定不完整就停止剛拿到的 track 並放棄，否則 `TranscriptInserter` 會綁在已銷毀的 editor 上，畫面顯示「停止」、清單上鎖，轉寫文字卻全部默默丟掉。
- 每個 session 固定一個 `TranscriptInserter`（插入點為按下錄製時的 `selection.to`）、一個 `OrderedBuffer`、一個 `ApiClient`。片段一交付就上傳（並行），結果依 `seq` 釋出後才插入；已插入的文字累積在 `transcript`，取最後 200 個字元（以 code point 計）當下一段的 prompt。
- `finish()` 只執行一次：設為 `stopping` → `recorder.stop()`（真的 `SegmentRecorder` 會在 resolve 前交付最後一段）→ 停止麥克風 track → 等到 `uploads` 清空（期間新加入的上傳也會等）→ 回到 `idle`。
- 卸載時停止麥克風；仍在途中的上傳會完成，但 inserter 已銷毀，不會再改動 editor。

- [ ] **Step 5: 執行測試與型別檢查，確認通過**

Run: `npm test -w @oc/core -- src/recording/useRecorder.test.ts && npm run typecheck -w @oc/core`
Expected: `Tests  9 passed (9)`；typecheck 無錯誤；輸出中沒有 `not wrapped in act(...)`。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/test/recorderHarness.ts packages/core/src/recording/useRecorder.ts packages/core/src/recording/useRecorder.test.ts
git commit -m "feat(core): add useRecorder with ordered transcript insertion"
```

---

### Task 14: `useRecorder`（二）：未轉寫標記、重送、401、413、中斷提示

**Files:**
- Modify: `packages/core/src/recording/useRecorder.ts`
- Test: `packages/core/src/recording/useRecorder.failures.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`waitFor`（真計時器）等候經過 fake-indexeddb 的非同步流程；中斷提示的測試以 `Object.defineProperty(document, 'visibilityState', …)` 控制頁面是否在背景，結束時移除。「重送中切換筆記」以 `rerender` 換上新的 editor 與 `noteId` 並銷毀舊 editor（就是 `useNoteEditor` 切換筆記時做的事），再讓延後的回應回來；「重送中刪除標記」用 `deleteRange` 模擬按 Backspace 刪掉標記。

`packages/core/src/recording/useRecorder.failures.test.ts`：

```ts
import { act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/apiClient';
import { CONFIGURED, createTestEditor, settle, setupRecorder } from '../test/recorderHarness';
import { createPendingQueue } from './pendingQueue';
import { RECORDER_MESSAGES } from './useRecorder';

type Ctx = Awaited<ReturnType<typeof setupRecorder>>;

const GAP_1 = '<span class="oc-gap" data-transcript-gap="gap-1">⚠ 第 1 段未轉寫・重試</span>';

/** Starts recording and pushes `count` segments through the fake recorder. */
async function recordSegments(ctx: Ctx, count: number) {
  await act(async () => {
    await ctx.result.current.start();
  });
  act(() => {
    for (let seq = 1; seq <= count; seq += 1) ctx.recorders[0].emit(seq);
  });
}

/** Stores audio for gap-1 of note n1, as an earlier recording would have. */
function keepAudioForGap1(ctx: Ctx) {
  return createPendingQueue(ctx.db).add({
    gapId: 'gap-1',
    noteId: 'n1',
    seq: 1,
    blob: new Blob(['x']),
    mimeType: 'audio/webm',
    prompt: '',
  });
}

/** Clicks the marker (retryGap) and waits until its request is out; the test answers it later. */
async function startRetry(ctx: Ctx, gapId: string) {
  let retried!: Promise<void>;
  act(() => {
    retried = ctx.result.current.retryGap(gapId);
  });
  await waitFor(() => expect(ctx.calls).toHaveLength(1));
  return { retried, call: ctx.calls[0] };
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('useRecorder: failures', () => {
  it('retries a failing segment 3 times, then inserts a gap and keeps the audio', async () => {
    const ctx = await setupRecorder();
    ctx.transcribe.mockImplementation(async (input) => {
      if (input.seq === 1) throw new ApiError('upstream', 502);
      return { seq: input.seq, text: '第二段' };
    });

    await recordSegments(ctx, 2);

    await waitFor(() => expect(ctx.editor.getHTML()).toBe(`<p>${GAP_1}第二段</p>`));
    expect(ctx.transcribe.mock.calls.filter(([input]) => input.seq === 1)).toHaveLength(4);
    expect(ctx.deps.sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
    expect(await createPendingQueue(ctx.db).get('gap-1')).toMatchObject({
      gapId: 'gap-1',
      noteId: 'n1',
      seq: 1,
      mimeType: 'audio/webm;codecs=opus',
      prompt: '',
    });
  });

  it('retryGap re-sends the kept audio and replaces the gap with the transcript', async () => {
    const ctx = await setupRecorder();
    ctx.transcribe.mockRejectedValue(new ApiError('down', 503));
    await recordSegments(ctx, 1);
    await waitFor(() => expect(ctx.editor.getHTML()).toBe(`<p>${GAP_1}</p>`));

    ctx.transcribe.mockReset();
    ctx.transcribe.mockResolvedValue({ seq: 1, text: '補上的文字' });
    await act(async () => {
      await ctx.result.current.retryGap('gap-1');
    });

    expect(ctx.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ seq: 1, prompt: '', filename: 'segment-1.webm' }),
    );
    expect(ctx.editor.getHTML()).toBe('<p>補上的文字</p>');
    expect(await createPendingQueue(ctx.db).get('gap-1')).toBeUndefined();
  });

  it('retryGap reads audio kept by an earlier page load from IndexedDB', async () => {
    const ctx = await setupRecorder({
      content: '<p>前<span class="oc-gap" data-transcript-gap="old">⚠ 第 4 段未轉寫・重試</span>後</p>',
    });
    await createPendingQueue(ctx.db).add({
      gapId: 'old',
      noteId: 'n1',
      seq: 4,
      blob: new Blob(['x']),
      mimeType: 'audio/mp4',
      prompt: '上文',
    });
    ctx.transcribe.mockResolvedValue({ seq: 4, text: '第四段' });

    await act(async () => {
      await ctx.result.current.retryGap('old');
    });

    expect(ctx.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ seq: 4, prompt: '上文', filename: 'segment-4.mp4' }),
    );
    expect(ctx.editor.getText()).toBe('前第四段後');
  });

  it('retryGap keeps the gap and says so when the retry fails too', async () => {
    const ctx = await setupRecorder();
    ctx.transcribe.mockRejectedValue(new ApiError('down', 500));
    await recordSegments(ctx, 1);
    await waitFor(() => expect(ctx.editor.getHTML()).toBe(`<p>${GAP_1}</p>`));

    await act(async () => {
      await ctx.result.current.retryGap('gap-1');
    });

    expect(ctx.result.current.error).toBe('重新轉寫失敗，請稍後再試');
    expect(ctx.editor.getHTML()).toBe(`<p>${GAP_1}</p>`);
    expect(await createPendingQueue(ctx.db).get('gap-1')).toBeDefined();
  });

  it('retryGap reports audio that is gone', async () => {
    const ctx = await setupRecorder();
    await act(async () => {
      await ctx.result.current.retryGap('unknown');
    });
    expect(ctx.result.current.error).toBe(RECORDER_MESSAGES.audioMissing);
    expect(ctx.transcribe).not.toHaveBeenCalled();
  });

  it('retryGap keeps the audio when another note is opened before the transcript arrives', async () => {
    const ctx = await setupRecorder({ content: `<p>${GAP_1}</p>` });
    await keepAudioForGap1(ctx);
    const { retried, call } = await startRetry(ctx, 'gap-1');

    // The user opens another note: NotesApp passes its editor, useNoteEditor destroys the old one.
    ctx.rerender({ settings: CONFIGURED, editor: createTestEditor(), noteId: 'n2' });
    ctx.editor.destroy();
    await act(async () => {
      call.resolve('補上的文字');
      await retried;
    });

    expect(await createPendingQueue(ctx.db).get('gap-1')).toBeDefined();
    expect(ctx.result.current.error).toBe(RECORDER_MESSAGES.retryFailed);

    // Back in the first note (a fresh editor from its saved content), the marker still works.
    const reopened = createTestEditor(`<p>${GAP_1}</p>`);
    ctx.rerender({ settings: CONFIGURED, editor: reopened, noteId: 'n1' });
    ctx.transcribe.mockResolvedValueOnce({ seq: 1, text: '補上的文字' });
    await act(async () => {
      await ctx.result.current.retryGap('gap-1');
    });

    expect(reopened.getHTML()).toBe('<p>補上的文字</p>');
    expect(ctx.result.current.error).toBeNull();
    expect(await createPendingQueue(ctx.db).get('gap-1')).toBeUndefined();
  });

  it('retryGap keeps the audio, without a message, when the marker was deleted while waiting', async () => {
    const ctx = await setupRecorder({ content: `<p>前${GAP_1}</p>` });
    await keepAudioForGap1(ctx);
    const { retried, call } = await startRetry(ctx, 'gap-1');

    act(() => {
      ctx.editor.commands.deleteRange({ from: 2, to: 3 }); // Backspace over the marker after 前
    });
    await act(async () => {
      call.resolve('補上的文字');
      await retried;
    });

    expect(ctx.editor.getHTML()).toBe('<p>前</p>');
    expect(ctx.result.current.error).toBeNull();
    // Undo can bring the marker back; the audio goes when the note is deleted (removeByNote).
    expect(await createPendingQueue(ctx.db).get('gap-1')).toBeDefined();
  });

  it('a rejected key (401) stops recording, keeps the audio as a gap and asks for settings', async () => {
    const ctx = await setupRecorder();
    ctx.transcribe.mockRejectedValue(new ApiError('unauthorized', 401, { code: 'unauthorized' }));

    await recordSegments(ctx, 1);

    await waitFor(() => expect(ctx.result.current.state).toBe('idle'));
    expect(ctx.transcribe).toHaveBeenCalledTimes(1); // 401 is never retried
    expect(ctx.result.current.error).toBe('存取金鑰錯誤，請重新設定');
    expect(ctx.onUnauthorized).toHaveBeenCalledTimes(1);
    expect(ctx.track.stop).toHaveBeenCalled();
    expect(ctx.editor.getHTML()).toBe(`<p>${GAP_1}</p>`);

    ctx.rerender({ settings: { ...CONFIGURED, accessKey: 'key-2' } });
    expect(ctx.result.current.error).toBeNull();
  });

  it('skips a segment the server refuses as too large (413) or malformed (400)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ctx = await setupRecorder();
    ctx.transcribe.mockImplementation(async (input) => {
      if (input.seq === 1) throw new ApiError('too large', 413);
      if (input.seq === 2) throw new ApiError('bad', 400);
      return { seq: input.seq, text: '第三段' };
    });

    await recordSegments(ctx, 3);

    await waitFor(() => expect(ctx.editor.getText()).toBe('第三段'));
    expect(ctx.editor.getHTML()).not.toContain('oc-gap');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('after an interruption in the background, shows a notice once the page is visible again', async () => {
    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    const ctx = await setupRecorder();
    await act(async () => {
      await ctx.result.current.start();
    });

    visibility = 'hidden';
    act(() => ctx.recorders[0].interrupt());
    await waitFor(() => expect(ctx.result.current.state).toBe('idle'));
    expect(ctx.result.current.notice).toBeNull();

    visibility = 'visible';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(ctx.result.current.notice).toBe('錄音已中斷，已錄的部分會照常轉寫');
  });

  it('dismissMessages clears the error and the notice', async () => {
    const ctx = await setupRecorder();
    await act(async () => {
      await ctx.result.current.start();
    });
    act(() => ctx.recorders[0].interrupt()); // visible: notice right away
    await settle();
    expect(ctx.result.current.notice).toBe(RECORDER_MESSAGES.interrupted);

    act(() => ctx.result.current.dismissMessages());

    expect(ctx.result.current.notice).toBeNull();
    expect(ctx.result.current.error).toBeNull();
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/core -- src/recording/useRecorder.failures.test.ts`
Expected: FAIL，`Tests  11 failed (11)`（stderr 會出現 Task 13 版本的 `Segment 1 could not be transcribed ApiError: …`，屬預期）：
- 三個等待標記的測試：`AssertionError: expected '<p>第二段</p>' to be '<p><span class="oc-gap" data-transcri…'`（或 `expected '<p></p>' …`）——失敗片段目前被略過，沒有插入標記。
- 四個直接呼叫 `retryGap` 的測試（讀 IndexedDB、音訊不見、重送中切換筆記、重送中刪除標記）：`TypeError: ctx.result.current.retryGap is not a function`。
- 401：`AssertionError: expected 'recording' to be 'idle'`。
- 413／400：`AssertionError: expected "warn" to be called 2 times, but got 0 times`。
- 中斷提示：`AssertionError: expected null to be '錄音已中斷，已錄的部分會照常轉寫'`。
- `dismissMessages`：`AssertionError: expected null to be undefined`（Task 13 的 `RECORDER_MESSAGES` 還沒有 `interrupted`）。

- [ ] **Step 3: 實作**

`packages/core/src/recording/useRecorder.ts` 完整內容（相對 Task 13：`SegmentResult` 多了 `gap`；`transcribeSegment` 依狀態碼分流；新增 `keepPending`、`handleUnauthorized`、`handleInterrupted`、`onVisibilityChange`、`retryGap`（綁定點擊當下的 editor，取代成功才刪除音訊）、`dismissMessages`；hook 建立 `pendingQueue`、監聽 `visibilitychange`、設定改變時清除錯誤）：

```ts
import type { Editor } from '@tiptap/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApiError, createApiClient, type ApiClient } from '../api/apiClient';
import { isConfigured, type Settings } from '../settings/settingsStore';
import { OrderedBuffer } from './orderedBuffer';
import {
  createPendingQueue,
  type AppDbHandle,
  type PendingQueue,
  type PendingSegment,
} from './pendingQueue';
import { extensionFor, pickMimeType } from './pickMimeType';
import { replaceGap } from './replaceGap';
import { withRetry } from './retry';
import { SegmentRecorder, type RecordedSegment, type SegmentRecorderOptions } from './segmentRecorder';
import { TranscriptInserter } from './transcriptInserter';

export type RecorderState = 'idle' | 'needsSetup' | 'recording' | 'stopping';

export const RECORDER_MESSAGES = {
  unauthorized: '存取金鑰錯誤，請重新設定',
  micDenied: '無法使用麥克風，請在系統或瀏覽器設定中允許麥克風權限',
  startFailed: '無法開始錄音，請再試一次',
  interrupted: '錄音已中斷，已錄的部分會照常轉寫',
  retryFailed: '重新轉寫失敗，請稍後再試',
  audioMissing: '找不到這段錄音，無法重新轉寫',
} as const;

/** How much of the text already inserted in this recording is sent as the prompt. */
export const PROMPT_CHARS = 200;

export interface SegmentRecorderHandle {
  start(): void;
  stop(): Promise<void>;
}

/** Everything useRecorder touches outside React; tests replace these. */
export interface RecorderDeps {
  getUserMedia(): Promise<MediaStream>;
  createRecorder(options: SegmentRecorderOptions): SegmentRecorderHandle;
  createClient(settings: Settings): ApiClient;
  pickMimeType(): string | undefined;
  /** Wait between retries. */
  sleep(ms: number): Promise<void>;
  newGapId(): string;
}

export const defaultRecorderDeps: RecorderDeps = {
  getUserMedia: () => {
    const media = globalThis.navigator?.mediaDevices;
    if (!media?.getUserMedia) return Promise.reject(new Error('getUserMedia is not available'));
    return media.getUserMedia({ audio: true });
  },
  createRecorder: (options) => new SegmentRecorder(options),
  createClient: (settings) =>
    createApiClient({ baseUrl: settings.apiBaseUrl, accessKey: settings.accessKey }),
  pickMimeType: () => pickMimeType(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  newGapId: () => crypto.randomUUID(),
};

export interface UseRecorderOptions {
  /** The editor transcripts go into (NotesApp's useNoteEditor editor). */
  editor: Editor;
  /** Active note; recording cannot start while it is undefined (notes still loading). */
  noteId: string | undefined;
  settings: Settings;
  /** App database (or openAppDb()'s promise) holding untranscribed audio. */
  db: AppDbHandle;
  /** The access key was rejected (401); NotesApp opens the settings dialog. */
  onUnauthorized?(): void;
  deps?: Partial<RecorderDeps>;
}

export interface UseRecorderResult {
  state: RecorderState;
  error: string | null;
  notice: string | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  retryGap(gapId: string): Promise<void>;
  dismissMessages(): void;
}

type Phase = 'idle' | 'recording' | 'stopping';

type SegmentResult =
  | { kind: 'text'; text: string }
  | { kind: 'gap'; gapId: string; seq: number }
  | { kind: 'skip' };

interface Session {
  noteId: string;
  client: ApiClient;
  stream: MediaStream;
  recorder: SegmentRecorderHandle;
  inserter: TranscriptInserter;
  buffer: OrderedBuffer<SegmentResult>;
  mimeType: string | undefined;
  /** Text inserted by this recording so far; its tail is the next prompt. */
  transcript: string;
  uploads: Set<Promise<void>>;
  unauthorized: boolean;
  finishing: Promise<void> | null;
}

interface ControllerEnv {
  options(): UseRecorderOptions;
  queue(): PendingQueue;
  setPhase(phase: Phase): void;
  setError(message: string | null): void;
  setNotice(message: string | null): void;
}

/**
 * Records with the microphone, uploads every segment as soon as it is cut (in parallel, with
 * retries) and inserts the transcripts strictly in recording order at the cursor position the
 * recording started from. A segment that still fails becomes a transcriptGap marker whose audio
 * is kept in IndexedDB until retryGap() succeeds.
 */
export function useRecorder(options: UseRecorderOptions): UseRecorderResult {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const queue = useMemo(() => createPendingQueue(options.db), [options.db]);

  const latest = useRef({ options, queue });
  useLayoutEffect(() => {
    latest.current = { options, queue };
  });

  const controllerRef = useRef<ReturnType<typeof createRecorderController> | null>(null);
  controllerRef.current ??= createRecorderController({
    options: () => latest.current.options,
    queue: () => latest.current.queue,
    setPhase,
    setError,
    setNotice,
  });
  const controller = controllerRef.current;

  useEffect(() => {
    document.addEventListener('visibilitychange', controller.onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', controller.onVisibilityChange);
      controller.dispose();
    };
  }, [controller]);

  // New settings (e.g. after a rejected key was replaced) clear the old error.
  const { apiBaseUrl, accessKey } = options.settings;
  useEffect(() => {
    setError(null);
  }, [apiBaseUrl, accessKey]);

  const state: RecorderState =
    phase !== 'idle' ? phase : isConfigured(options.settings) ? 'idle' : 'needsSetup';

  return {
    state,
    error,
    notice,
    start: controller.start,
    stop: controller.stop,
    retryGap: controller.retryGap,
    dismissMessages: controller.dismissMessages,
  };
}

function createRecorderController(env: ControllerEnv) {
  let session: Session | null = null;
  let starting = false;
  let interruptedWhileHidden = false;
  /** Audio of gaps from this page load; IndexedDB is the fallback (e.g. after a reload). */
  const pending = new Map<string, PendingSegment>();
  const retrying = new Set<string>();

  const deps = (): RecorderDeps => ({ ...defaultRecorderDeps, ...env.options().deps });

  async function start(): Promise<void> {
    const { editor, noteId, settings } = env.options();
    if (session || starting || !noteId || !isConfigured(settings)) return;
    starting = true;
    try {
      const d = deps();
      env.setError(null);
      env.setNotice(null);
      let stream: MediaStream;
      try {
        stream = await d.getUserMedia();
      } catch {
        env.setError(RECORDER_MESSAGES.micDenied);
        return;
      }
      // The permission prompt does not block the page, so the user may have opened another note
      // (useNoteEditor then destroys this editor) or changed the settings meanwhile. Only record
      // into the note that is still on screen.
      const now = env.options();
      if (
        now.noteId !== noteId ||
        now.editor !== editor ||
        editor.isDestroyed ||
        !isConfigured(now.settings)
      ) {
        stopTracks(stream);
        return;
      }
      const mimeType = d.pickMimeType();
      // Assigned right below, before the recorder can call back.
      let current: Session;
      const recorder = d.createRecorder({
        stream,
        mimeType,
        onSegment: (segment) => handleSegment(current, segment),
        onInterrupted: () => handleInterrupted(current),
      });
      current = {
        noteId,
        client: d.createClient(now.settings),
        stream,
        recorder,
        inserter: new TranscriptInserter(editor, editor.state.selection.to),
        buffer: new OrderedBuffer<SegmentResult>(),
        mimeType,
        transcript: '',
        uploads: new Set(),
        unauthorized: false,
        finishing: null,
      };
      try {
        recorder.start();
      } catch (error) {
        console.error('Failed to start recording', error);
        stopTracks(stream);
        current.inserter.destroy();
        env.setError(RECORDER_MESSAGES.startFailed);
        return;
      }
      session = current;
      env.setPhase('recording');
    } finally {
      starting = false;
    }
  }

  async function stop(): Promise<void> {
    if (session) await finish(session);
  }

  function finish(current: Session): Promise<void> {
    current.finishing ??= (async () => {
      env.setPhase('stopping');
      // Delivers the last segment through onSegment before it resolves.
      await current.recorder
        .stop()
        .catch((error: unknown) => console.error('Failed to stop recording', error));
      stopTracks(current.stream);
      while (current.uploads.size > 0) await Promise.allSettled([...current.uploads]);
      current.inserter.destroy();
      if (session === current) session = null;
      env.setPhase('idle');
    })();
    return current.finishing;
  }

  function handleSegment(current: Session, { seq, blob }: RecordedSegment): void {
    const prompt = tail(current.transcript, PROMPT_CHARS);
    const mimeType = blob.type || current.mimeType || '';
    const upload: Promise<void> = transcribeSegment(current, seq, blob, mimeType, prompt)
      .then((result) => release(current, seq, result))
      .catch((error: unknown) => console.error(`Failed to handle segment ${seq}`, error))
      .finally(() => {
        current.uploads.delete(upload);
      });
    current.uploads.add(upload);
  }

  async function transcribeSegment(
    current: Session,
    seq: number,
    blob: Blob,
    mimeType: string,
    prompt: string,
  ): Promise<SegmentResult> {
    const d = deps();
    try {
      const response = await withRetry(
        () =>
          current.client.transcribe({
            audio: blob,
            seq,
            prompt,
            filename: `segment-${seq}.${extensionFor(mimeType)}`,
          }),
        { sleep: d.sleep },
      );
      return response.text.trim() === '' ? { kind: 'skip' } : { kind: 'text', text: response.text };
    } catch (error) {
      const status = error instanceof ApiError ? error.status : undefined;
      if (status === 400 || status === 413) {
        console.warn(`Segment ${seq} was rejected with ${status} and skipped`, error);
        return { kind: 'skip' };
      }
      if (status === 401) handleUnauthorized(current);
      // Network errors and 5xx after every retry, 401 and anything unexpected: keep the audio.
      const gapId = d.newGapId();
      await keepPending({ gapId, noteId: current.noteId, seq, blob, mimeType, prompt });
      return { kind: 'gap', gapId, seq };
    }
  }

  /** Inserts every result that is now next in line. */
  function release(current: Session, seq: number, result: SegmentResult): void {
    for (const item of current.buffer.put(seq, result)) {
      if (item.kind === 'text') {
        current.inserter.insertText(item.text);
        current.transcript += item.text;
      } else if (item.kind === 'gap') {
        current.inserter.insertGap(item.gapId, item.seq);
      }
    }
  }

  async function keepPending(item: PendingSegment): Promise<void> {
    pending.set(item.gapId, item);
    try {
      await env.queue().add(item);
    } catch (error) {
      console.error('Failed to keep an untranscribed segment', error);
    }
  }

  function handleUnauthorized(current: Session): void {
    if (current.unauthorized) return;
    current.unauthorized = true;
    env.setError(RECORDER_MESSAGES.unauthorized);
    env.options().onUnauthorized?.();
    void finish(current);
  }

  function handleInterrupted(current: Session): void {
    if (document.visibilityState === 'hidden') interruptedWhileHidden = true;
    else env.setNotice(RECORDER_MESSAGES.interrupted);
    void finish(current);
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'visible' && interruptedWhileHidden) {
      interruptedWhileHidden = false;
      env.setNotice(RECORDER_MESSAGES.interrupted);
    }
  }

  async function retryGap(gapId: string): Promise<void> {
    // The editor the marker was clicked in. The note list stays usable while a retry runs (up to
    // 1s+2s+4s of backoff plus 30s per attempt), so by the time the answer arrives the props may
    // already hold another note's editor.
    const { settings, editor } = env.options();
    if (retrying.has(gapId) || !isConfigured(settings)) return;
    retrying.add(gapId);
    try {
      const item = pending.get(gapId) ?? (await env.queue().get(gapId).catch(() => undefined));
      if (!item) {
        env.setError(RECORDER_MESSAGES.audioMissing);
        return;
      }
      const d = deps();
      const client = d.createClient(settings);
      const response = await withRetry(
        () =>
          client.transcribe({
            audio: item.blob,
            seq: item.seq,
            prompt: item.prompt,
            filename: `segment-${item.seq}.${extensionFor(item.mimeType)}`,
          }),
        { sleep: d.sleep },
      );
      const text = response.text.trim() === '' ? '' : response.text;
      if (!replaceGap(editor, gapId, text)) {
        // Nothing was replaced, so the audio is still the only copy: keep it. A destroyed editor
        // means the note was switched or deleted; the marker can be clicked again after going
        // back. A live editor without the marker means the user deleted it; undo can bring it
        // back, and the audio goes when the note is deleted (removeByNote).
        if (editor.isDestroyed) env.setError(RECORDER_MESSAGES.retryFailed);
        return;
      }
      pending.delete(gapId);
      await env
        .queue()
        .remove(gapId)
        .catch((error: unknown) => console.error('Failed to drop a retried segment', error));
      env.setError(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        env.setError(RECORDER_MESSAGES.unauthorized);
        env.options().onUnauthorized?.();
      } else {
        env.setError(RECORDER_MESSAGES.retryFailed);
      }
    } finally {
      retrying.delete(gapId);
    }
  }

  function dismissMessages(): void {
    env.setError(null);
    env.setNotice(null);
  }

  /** Unmount: stop the microphone; uploads still finish but insert nothing. */
  function dispose(): void {
    const current = session;
    if (!current) return;
    session = null;
    current.inserter.destroy();
    void current.recorder.stop().catch(() => undefined);
    stopTracks(current.stream);
  }

  return { start, stop, retryGap, dismissMessages, onVisibilityChange, dispose };
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** The last `count` characters (code points) of text. */
function tail(text: string, count: number): string {
  const chars = Array.from(text);
  return chars.length <= count ? text : chars.slice(-count).join('');
}
```

重點：
- 未轉寫標記也走 `OrderedBuffer`：失敗片段的音訊先存好（記憶體 `pending` + IndexedDB），標記才依 `seq` 插入，所以「⚠ 第 1 段」一定出現在第 2 段文字之前。IndexedDB 寫入失敗只記錄錯誤，記憶體中的音訊仍可在本次開啟期間重送。
- `retryGap` 先找記憶體，再找 IndexedDB（重新整理後只剩後者）；成功後 `replaceGap` 並把音訊移出佇列。同一個標記重送中再點一次會被忽略。
- `retryGap` 在點擊當下取 editor，而且只有 `replaceGap` 回傳 `true` 時才刪除音訊。重送期間切到別篇筆記（舊 editor 被銷毀）時保留音訊並顯示「重新轉寫失敗，請稍後再試」，回到原筆記點擊標記即可重送；標記在等待期間被使用者刪掉時同樣保留音訊、不顯示訊息。
- `start()` 與 Task 13 相同：權限詢問結束後重新確認筆記與 editor 沒換。
- 401 時 `handleUnauthorized` 只執行一次：顯示錯誤、通知 `onUnauthorized()`、結束錄音；同一 session 之後再收到的 401 片段也都存成標記。

- [ ] **Step 4: 執行測試與型別檢查，確認通過**

Run: `npm test -w @oc/core -- src/recording/useRecorder.test.ts src/recording/useRecorder.failures.test.ts && npm run typecheck -w @oc/core`
Expected: `Test Files  2 passed (2)`、`Tests  20 passed (20)`；typecheck 無錯誤；輸出中沒有 `not wrapped in act(...)`。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recording/useRecorder.ts packages/core/src/recording/useRecorder.failures.test.ts
git commit -m "feat(core): keep failed segments as retryable gaps and handle 401/413/interruptions"
```

---

### Task 15: 接上錄音 UI（含端對端測試）

**Files:**
- Modify: `packages/core/src/components/ActionBar.tsx`
- Modify: `packages/core/src/components/NoteList.tsx`
- Modify: `packages/core/src/NotesApp.tsx`
- Modify: `packages/core/src/styles/app.css`
- Modify: `packages/core/src/components/ActionBar.test.tsx`
- Modify: `packages/core/src/components/NoteList.test.tsx`
- Modify: `packages/core/src/NotesApp.test.tsx`
- Create: `packages/core/src/NotesApp.recording.test.tsx`
- Test: `apps/web/e2e/recording.spec.ts`

- [ ] **Step 1: 寫失敗的端對端測試**

Playwright 設定（M1）已帶 `--use-fake-ui-for-media-stream`（自動允許麥克風）與 `--use-fake-device-for-media-stream`（假麥克風持續送出測試音）。後端網址設成開發伺服器同源的 `http://localhost:5173/mock-api`，`page.route` 攔下所有請求，不牽涉 CORS、也不需要啟動 M3a。`seqOf` 從 multipart 內容讀出 `seq`。第一個測試讓第 1 段的回應等到第 2 段送出後才回（最多等 10 秒，第 2 段沒出現時會在內文斷言清楚失敗，而不是卡到逾時），驗證插入順序；第二個測試讓第 1 段連續回 500，驗證 1+3 次後出現標記，重新整理後（音訊只能從 IndexedDB 取得）點擊標記補上。兩個測試都在看到第 1 段上傳後再等 1.5 秒才按「停止」：剛在切段點開始的尾段若在約 100ms 內就停止，Chromium 的 Opus 編碼器可能還沒產出第一個 frame，得到 0 bytes 的 Blob 而被 `SegmentRecorder` 略過；切段至少相隔 4 秒，所以這 1.5 秒內不會再切出第 3 段。

`apps/web/e2e/recording.spec.ts`：

```ts
import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * The mocked backend lives under the dev server's own origin, so no CORS is involved; every
 * request to it is answered by page.route below and never reaches Vite.
 */
const API = 'http://localhost:5173/mock-api';

/** `seq` from the multipart body the app posts to /transcribe. */
function seqOf(route: Route): number {
  const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
  const match = /name="seq"\r\n\r\n(\d+)/.exec(body);
  if (!match) throw new Error('no seq field in the /transcribe request');
  return Number(match[1]);
}

const transcript = (route: Route, seq: number) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ seq, text: `第${seq}段。` }) });

/** Rows in the app's IndexedDB store `pendingSegments` (audio waiting for a retry). */
function pendingCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('open-copilot');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('pendingSegments', 'readonly').objectStore('pendingSegments').count();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
        };
      }),
  );
}

/** Whether the saved note body (IndexedDB store `notes`) already contains a transcript gap. */
function savedNoteHasGap(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open('open-copilot');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('notes', 'readonly').objectStore('notes').getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(JSON.stringify(request.result).includes('"transcriptGap"'));
          };
        };
      }),
  );
}

test('設定後端後錄音，轉寫結果依錄音順序插入游標位置', async ({ page }) => {
  test.setTimeout(60_000);
  const seen: number[] = [];
  const authorization: (string | undefined)[] = [];
  let secondArrived: () => void = () => undefined;
  const second = new Promise<void>((resolve) => (secondArrived = resolve));

  await page.route(`${API}/health`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
  );
  await page.route(`${API}/transcribe`, async (route) => {
    const seq = seqOf(route);
    seen.push(seq);
    authorization.push(route.request().headers()['authorization']);
    if (seq === 2) secondArrived();
    // Answer segment 1 only after segment 2 was sent: the app must still insert 1 before 2.
    // Bounded, so a missing segment 2 fails on the body text below instead of hanging.
    if (seq === 1) await Promise.race([second, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    await transcript(route, seq);
  });

  await page.goto('/');
  const record = page.locator('.oc-record-btn');
  await expect(record).toHaveText('請先設定');

  await record.click();
  const dialog = page.getByRole('dialog', { name: '設定' });
  await dialog.getByLabel('後端網址').fill(API);
  await dialog.getByLabel('存取金鑰').fill('dev-key');
  await dialog.getByRole('button', { name: '測試連線' }).click();
  await expect(dialog.getByText('連線成功')).toBeVisible();
  await dialog.getByRole('button', { name: '儲存' }).click();
  await expect(dialog).toBeHidden();
  await expect(record).toHaveText('錄製');

  const body = page.getByRole('textbox', { name: '筆記內文' });
  await body.click();
  await page.keyboard.type('開頭');

  await record.click();
  await expect(record).toHaveText('停止');
  await expect(page.getByRole('button', { name: '新增筆記' })).toBeDisabled();

  // The first cut comes after 4–8 seconds; stopping then sends the rest as segment 2.
  await expect.poll(() => seen.length, { timeout: 15_000 }).toBeGreaterThan(0);
  // Give the tail segment real encoded audio first: a MediaRecorder stopped within ~100 ms of
  // starting can yield an empty Blob, which SegmentRecorder drops (no segment 2). Cuts are at
  // least 4 s apart, so no second cut happens in this wait.
  await page.waitForTimeout(1_500);
  await record.click();

  await expect(record).toHaveText('錄製', { timeout: 15_000 });
  await expect(body).toHaveText('開頭第1段。第2段。');
  expect(seen.sort()).toEqual([1, 2]);
  expect(authorization).toEqual(['Bearer dev-key', 'Bearer dev-key']);
  await expect(page.getByRole('button', { name: '新增筆記' })).toBeEnabled();
});

test('一段連續失敗 4 次變成未轉寫標記，重新整理後點擊標記可補上', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript((api) => {
    localStorage.setItem('oc.settings', JSON.stringify({ apiBaseUrl: api, accessKey: 'dev-key' }));
  }, API);
  let failSegmentOne = true;
  let segmentOneAttempts = 0;
  await page.route(`${API}/transcribe`, async (route) => {
    const seq = seqOf(route);
    if (seq === 1 && failSegmentOne) {
      segmentOneAttempts += 1;
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"upstream_error"}' });
      return;
    }
    await transcript(route, seq);
  });

  await page.goto('/');
  const record = page.locator('.oc-record-btn');
  const body = page.getByRole('textbox', { name: '筆記內文' });
  await expect(record).toHaveText('錄製');
  await expect(record).toBeEnabled();
  await body.click();

  await record.click();
  await expect(record).toHaveText('停止');
  await expect.poll(() => segmentOneAttempts, { timeout: 15_000 }).toBeGreaterThan(0);
  // Same as above: the tail segment (segment 2) needs real encoded audio before stopping.
  await page.waitForTimeout(1_500);
  await record.click();

  // 1 try + 3 retries after 1s, 2s and 4s.
  const gap = page.locator('[data-transcript-gap]');
  await expect(gap).toHaveText('⚠ 第 1 段未轉寫・重試', { timeout: 20_000 });
  expect(segmentOneAttempts).toBe(4);
  await expect(body).toHaveText('⚠ 第 1 段未轉寫・重試第2段。');
  await expect(record).toHaveText('錄製');
  expect(await pendingCount(page)).toBe(1);

  // After a reload the audio comes from IndexedDB, not from memory.
  await expect.poll(() => savedNoteHasGap(page)).toBe(true);
  await page.reload();
  await expect(gap).toHaveText('⚠ 第 1 段未轉寫・重試');

  failSegmentOne = false;
  await gap.click();

  await expect(body).toHaveText('第1段。第2段。');
  await expect(gap).toHaveCount(0);
  await expect.poll(() => pendingCount(page)).toBe(0);
});
```

- [ ] **Step 2: 執行端對端測試，確認失敗**

Run: `npm run e2e -w @oc/web -- e2e/recording.spec.ts`
Expected: `2 failed`：第一個測試在 `expect(record).toHaveText('請先設定')`（實際為 `錄製`）失敗；第二個測試在 `expect(record).toBeEnabled()`（M1 的錄製鈕是 disabled）失敗。各約 5 秒。

- [ ] **Step 3: 更新 `ActionBar` 測試**

`packages/core/src/components/ActionBar.test.tsx` 完整內容：

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RecorderState } from '../recording/useRecorder';
import { ActionBar } from './ActionBar';

function setup(recordState: RecorderState = 'idle') {
  const onRecord = vi.fn();
  const onOpenSettings = vi.fn();
  const view = render(
    <ActionBar recordState={recordState} onRecord={onRecord} onOpenSettings={onOpenSettings} />,
  );
  return { ...view, onRecord, onOpenSettings, user: userEvent.setup() };
}

describe('ActionBar', () => {
  it.each([
    ['idle', '錄製', true],
    ['needsSetup', '請先設定', true],
    ['recording', '停止', true],
    ['stopping', '處理中', false],
  ] as const)('labels the record button for %s as %s', (state, label, enabled) => {
    setup(state);
    const button = screen.getByRole('button', { name: label });
    expect(button).toHaveClass('oc-record-btn');
    if (enabled) expect(button).toBeEnabled();
    else expect(button).toBeDisabled();
  });

  it('marks the record button while recording', () => {
    setup('recording');
    expect(screen.getByRole('button', { name: '停止' })).toHaveClass('is-recording');
  });

  it('calls onRecord when the record button is pressed', async () => {
    const { user, onRecord } = setup('idle');
    await user.click(screen.getByRole('button', { name: '錄製' }));
    expect(onRecord).toHaveBeenCalledTimes(1);
  });

  it('opens the settings from the gear button', async () => {
    const { user, onOpenSettings } = setup();
    await user.click(screen.getByRole('button', { name: '設定' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('shows the four locked AI buttons in order', () => {
    setup();
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

- [ ] **Step 4: 加入 `NoteList` 停用測試**

`packages/core/src/components/NoteList.test.tsx` 完整內容（相對 M1 只在最後多了 `disables creating, switching and deleting while disabled (recording)`）：

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

  it('disables creating, switching and deleting while disabled (recording)', async () => {
    const handlers = { onSelect: vi.fn(), onCreate: vi.fn(), onDelete: vi.fn() };
    render(<NoteList notes={NOTES} activeId="b" disabled {...handlers} />);
    const buttons = within(screen.getByRole('navigation', { name: '筆記' })).getAllByRole('button');
    expect(buttons).toHaveLength(5);
    for (const button of buttons) expect(button).toBeDisabled();

    await userEvent.setup().click(screen.getByRole('button', { name: /^未命名筆記/ }));
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: 更新 `NotesApp` 既有測試**

M1 的錄製鈕是 disabled 的「錄製」；接上錄音後，沒有設定時它是可按的「請先設定」。把 `packages/core/src/NotesApp.test.tsx` 中這段：

```tsx
  it('renders the action bar, banner and toolbar', async () => {
    await renderApp();
    expect(screen.getByRole('button', { name: '錄製' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'AI 摘要' })).toBeDisabled();
```

換成：

```tsx
  it('renders the action bar, banner and toolbar', async () => {
    await renderApp();
    // No backend configured yet (jsdom localStorage starts empty).
    expect(screen.getByRole('button', { name: '請先設定' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '設定' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'AI 摘要' })).toBeDisabled();
```

該測試其餘兩行（Banner、工具列）與檔案其他部分不變。

- [ ] **Step 6: 新增錄音整合測試**

用 `test/media.ts` 的假麥克風（`navigator.mediaDevices` + `FakeMediaRecorder`；jsdom 沒有 `AudioContext`，`SegmentRecorder` 自動退回 8 秒切段，測試在那之前就按停止）與 `vi.stubGlobal('fetch', …)` 的假後端，走真正的 `useRecorder` → `SegmentRecorder` → `createApiClient` → 編輯器。點擊編輯器內的標記用 `fireEvent.click`（見「與共用契約的關係」的 jsdom 限制）。`renderApp` 可帶入初始筆記；刪除筆記的測試事先在 `'open-copilot'`（`NotesApp` 的錄音佇列所用的資料庫，這裡是 fake-indexeddb）放兩筆音訊，只有被刪筆記的那一筆應該消失。

`packages/core/src/NotesApp.recording.test.tsx`：

```tsx
import { EMPTY_DOC, type Note } from '@oc/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotesApp } from './NotesApp';
import { openAppDb } from './platform/db';
import { PlatformProvider } from './platform/PlatformContext';
import { createPendingQueue } from './recording/pendingQueue';
import { createFakeStream, FakeMediaRecorder } from './test/media';
import { createTestPlatform } from './test/memoryStorage';

const SETTINGS = { apiBaseUrl: 'https://api.test', accessKey: 'key-1' };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Fake microphone: navigator.mediaDevices + MediaRecorder (jsdom has neither, nor AudioContext). */
function installMicrophone() {
  const media = createFakeStream();
  const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => media.stream);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  FakeMediaRecorder.reset();
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  return { ...media, getUserMedia };
}

/** Fake backend behind fetch: /transcribe answers with respond(seq). */
function installBackend(respond: (seq: number) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/health')) return json({ ok: true });
    return respond(Number((init?.body as FormData).get('seq')));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderApp({ configured = true, notes = [] }: { configured?: boolean; notes?: Note[] } = {}) {
  if (configured) localStorage.setItem('oc.settings', JSON.stringify(SETTINGS));
  const ctx = createTestPlatform(notes);
  render(
    <PlatformProvider platform={ctx.platform}>
      <NotesApp />
    </PlatformProvider>,
  );
  await screen.findByRole('textbox', { name: '標題' });
  return { ...ctx, user: userEvent.setup() };
}

const body = () => screen.getByRole('textbox', { name: '筆記內文' });
const button = (name: string) => screen.getByRole('button', { name });

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('NotesApp recording', () => {
  it('asks for a backend first and saves it from the settings dialog', async () => {
    const { user } = await renderApp({ configured: false });

    await user.click(button('請先設定'));
    const dialog = screen.getByRole('dialog', { name: '設定' });
    await user.type(within(dialog).getByLabelText('後端網址'), 'https://api.test/');
    await user.type(within(dialog).getByLabelText('存取金鑰'), 'key-1');
    await user.click(within(dialog).getByRole('button', { name: '儲存' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button('錄製')).toBeEnabled();
    expect(JSON.parse(localStorage.getItem('oc.settings') ?? '')).toEqual(SETTINGS);
  });

  it('opens the settings from the gear button with the saved values', async () => {
    const { user } = await renderApp();
    await user.click(button('設定'));
    expect(screen.getByLabelText('後端網址')).toHaveValue('https://api.test');
    await user.click(button('取消'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('records into the note and locks the note list until the transcript is in', async () => {
    const mic = installMicrophone();
    const fetchMock = installBackend((seq) => json({ seq, text: '你好世界' }));
    const { user } = await renderApp();

    await user.click(button('錄製'));
    expect(await screen.findByRole('button', { name: '停止' })).toBeEnabled();
    expect(mic.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(button('新增筆記')).toBeDisabled();
    expect(screen.getByRole('button', { name: /^未命名筆記/ })).toBeDisabled();

    await user.click(button('停止'));

    expect(await screen.findByRole('button', { name: '錄製' })).toBeEnabled();
    expect(body()).toHaveTextContent('你好世界');
    expect(button('新增筆記')).toBeEnabled();
    expect(mic.track.stop).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.test/transcribe');
    expect(init?.headers).toEqual({ Authorization: 'Bearer key-1' });
  });

  it('a rejected key opens the settings and leaves a gap that a click retries', async () => {
    installMicrophone();
    let accepted = false;
    const fetchMock = installBackend((seq) =>
      accepted ? json({ seq, text: '補上了' }) : json({ error: 'unauthorized' }, 401),
    );
    const { user } = await renderApp();

    await user.click(button('錄製'));
    await user.click(await screen.findByRole('button', { name: '停止' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('存取金鑰錯誤，請重新設定');
    const dialog = await screen.findByRole('dialog', { name: '設定' });
    const gap = await screen.findByText('⚠ 第 1 段未轉寫・重試');
    expect(button('錄製')).toBeEnabled();

    const key = within(dialog).getByLabelText('存取金鑰');
    await user.clear(key);
    await user.type(key, 'key-2');
    await user.click(within(dialog).getByRole('button', { name: '儲存' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    accepted = true;
    // fireEvent, not user.click: the mousedown user-event sends first makes ProseMirror call
    // document.elementFromPoint, which jsdom does not have. The retry only needs the click.
    fireEvent.click(gap);

    await waitFor(() => expect(body()).toHaveTextContent('補上了'));
    expect(screen.queryByText('⚠ 第 1 段未轉寫・重試')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.at(-1)?.[1]?.headers).toEqual({ Authorization: 'Bearer key-2' });
  });

  it('shows a refused microphone in an alert that can be dismissed', async () => {
    const mic = installMicrophone();
    mic.getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    const { user } = await renderApp();

    await user.click(button('錄製'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法使用麥克風，請在系統或瀏覽器設定中允許麥克風權限',
    );
    expect(button('錄製')).toBeEnabled();
    await user.click(button('關閉訊息'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('deleting a note also drops the audio kept for its untranscribed segments', async () => {
    // NotesApp's recording queue uses the app database 'open-copilot' (fake-indexeddb here).
    const queue = createPendingQueue(openAppDb());
    const audio = { seq: 1, blob: new Blob(['x']), mimeType: 'audio/webm', prompt: '' };
    await queue.add({ ...audio, gapId: 'gap-of-deleted-note', noteId: 'with-gap' });
    await queue.add({ ...audio, gapId: 'gap-of-other-note', noteId: 'other' });
    const withGap: Note = {
      id: 'with-gap',
      title: '有標記',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '前' },
              { type: 'transcriptGap', attrs: { gapId: 'gap-of-deleted-note', seq: 1 } },
            ],
          },
        ],
      },
      createdAt: 2,
      updatedAt: 2,
    };
    const other: Note = { id: 'other', title: '其他', content: EMPTY_DOC, createdAt: 1, updatedAt: 1 };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, storage } = await renderApp({ notes: [withGap, other] });
    expect(await screen.findByText('⚠ 第 1 段未轉寫・重試')).toBeInTheDocument();

    await user.click(button('刪除「有標記」'));

    await waitFor(() => expect(storage.remove).toHaveBeenCalledWith('with-gap'));
    await waitFor(async () => expect(await queue.get('gap-of-deleted-note')).toBeUndefined());
    expect(await queue.get('gap-of-other-note')).toBeDefined();
  });
});
```

- [ ] **Step 7: 執行元件測試，確認失敗**

Run: `npm test -w @oc/core -- src/components/ActionBar.test.tsx src/components/NoteList.test.tsx src/NotesApp.test.tsx src/NotesApp.recording.test.tsx`
Expected: FAIL，`Test Files  4 failed (4)`、`Tests  15 failed | 15 passed (30)`：
- `ActionBar.test.tsx` 7 個失敗（只有 AI 鈕的測試通過）：`Unable to find an accessible element with the role "button" and name "請先設定"`／`"停止"`／`"處理中"`／`"設定"`，`idle` 那一個是 `expect(element).toBeEnabled()`（M1 的錄製鈕是 disabled）。
- `NoteList.test.tsx` 1 個失敗：新的停用測試（按鈕沒有 disabled）。
- `NotesApp.test.tsx` 1 個失敗：`Unable to find an accessible element with the role "button" and name "請先設定"`。
- `NotesApp.recording.test.tsx` 6 個全部失敗：前 5 個找不到「請先設定」、「設定」、「停止」或 `role="alert"`；刪除筆記的測試是 `AssertionError: expected { gapId: 'gap-of-deleted-note', …(5) } to be undefined`（M2 的 `NotesApp` 刪除筆記時不碰 `pendingSegments`）。

- [ ] **Step 8: 修改 `ActionBar`**

`packages/core/src/components/ActionBar.tsx` 完整內容：

```tsx
import { LoaderCircle, Lock, Mic, Settings, Square } from 'lucide-react';
import type { RecorderState } from '../recording/useRecorder';

export const AI_FEATURES = ['AI 摘要', '待辦事項', 'AI 助理', 'AI 對話'] as const;

export const RECORD_LABELS: Record<RecorderState, string> = {
  idle: '錄製',
  needsSetup: '請先設定',
  recording: '停止',
  stopping: '處理中',
};

export interface ActionBarProps {
  recordState: RecorderState;
  /** 錄製 → start, 停止 → stop, 請先設定 → open the settings (decided by NotesApp). */
  onRecord(): void;
  onOpenSettings(): void;
}

function RecordIcon({ state }: { state: RecorderState }) {
  if (state === 'recording') return <Square size={16} aria-hidden="true" />;
  if (state === 'stopping') return <LoaderCircle size={18} className="oc-spin" aria-hidden="true" />;
  return <Mic size={18} aria-hidden="true" />;
}

export function ActionBar({ recordState, onRecord, onOpenSettings }: ActionBarProps) {
  return (
    <div className="oc-actionbar">
      <button
        type="button"
        className={recordState === 'recording' ? 'oc-record-btn is-recording' : 'oc-record-btn'}
        disabled={recordState === 'stopping'}
        aria-busy={recordState === 'stopping' ? true : undefined}
        onClick={onRecord}
      >
        <RecordIcon state={recordState} />
        <span>{RECORD_LABELS[recordState]}</span>
      </button>
      <div className="oc-actionbar-end">
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
        <button
          type="button"
          className="oc-settings-btn"
          aria-label="設定"
          title="設定"
          onClick={onOpenSettings}
        >
          <Settings size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: 修改 `NoteList`**

`packages/core/src/components/NoteList.tsx` 完整內容（相對 M1：props 多 `disabled`，三種按鈕都加上 `disabled={disabled}`）：

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
  /** While recording, notes cannot be created, switched or deleted. */
  disabled?: boolean;
}

const timeFormat = new Intl.DateTimeFormat('zh-TW', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function NoteList({
  notes,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  disabled = false,
}: NoteListProps) {
  return (
    <nav className="oc-notelist" aria-label="筆記">
      <div className="oc-notelist-header">
        <h2>筆記</h2>
        <button
          type="button"
          className="oc-icon-btn"
          aria-label="新增筆記"
          title="新增筆記"
          disabled={disabled}
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
                disabled={disabled}
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
                disabled={disabled}
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

- [ ] **Step 10: 修改 `NotesApp`**

`packages/core/src/NotesApp.tsx` 完整內容（相對 M2：設定 state 與 `SettingsDialog`、錄音佇列的資料庫連線、`useRecorder`、`ActionBar` 的新 props、`NoteList` 的 `disabled`、錯誤／提示列、`.oc-document` 的點擊委派、刪除筆記成功後 `removeByNote` 清掉該筆記的未轉寫音訊）：

```tsx
import { EMPTY_DOC } from '@oc/shared';
import { Menu, X } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import { ActionBar } from './components/ActionBar';
import { Banner } from './components/Banner';
import { NoteList } from './components/NoteList';
import { SettingsDialog } from './components/SettingsDialog';
import { Editor } from './editor/Editor';
import { TitleInput } from './editor/TitleInput';
import { Toolbar } from './editor/Toolbar';
import { useNoteEditor } from './editor/useNoteEditor';
import { displayTitle } from './notes/noteStore';
import { useNotes } from './notes/useNotes';
import { openAppDb } from './platform/db';
import { usePlatform } from './platform/PlatformContext';
import { createPendingQueue } from './recording/pendingQueue';
import { useRecorder } from './recording/useRecorder';
import { useSettings } from './settings/useSettings';
import './styles/app.css';

/** A second connection to the app database, for the recording queue (Platform stays as is). */
function openRecorderDb() {
  const db = openAppDb();
  // Failures surface where the queue is used; this only keeps them from being "unhandled".
  db.catch((error: unknown) => console.error('Failed to open the recording queue', error));
  return db;
}

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
  const { settings, saveSettings } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recorderDb] = useState(openRecorderDb);

  // Called unconditionally (rules of hooks); recreated whenever the active note changes.
  const editor = useNoteEditor({
    noteId: activeNote?.id,
    content: activeNote?.content ?? EMPTY_DOC,
    onChange: (content) => updateActive({ content }),
  });

  const recorder = useRecorder({
    editor,
    noteId: activeNote?.id,
    settings,
    db: recorderDb,
    onUnauthorized: () => setSettingsOpen(true),
  });

  if (loading || !activeNote) {
    return (
      <div className="oc-loading" role="status">
        載入中…
      </div>
    );
  }

  const closeDrawer = () => setDrawerOpen(false);
  const recording = recorder.state === 'recording' || recorder.state === 'stopping';

  const confirmDelete = (id: string) => {
    const target = notes.find((n) => n.id === id);
    if (!target) return;
    if (window.confirm(`確定要刪除「${displayTitle(target)}」嗎？此動作無法復原。`)) {
      // Once the note is gone its ⚠ markers can never be retried, so drop their audio as well
      // (only after the note itself was deleted; a failed delete keeps both).
      void deleteNote(id).then(() =>
        createPendingQueue(recorderDb)
          .removeByNote(id)
          .catch((error: unknown) =>
            console.error('Failed to drop the untranscribed audio of a deleted note', error),
          ),
      );
    }
  };

  const onRecord = () => {
    if (recorder.state === 'needsSetup') setSettingsOpen(true);
    else if (recorder.state === 'idle') void recorder.start();
    else if (recorder.state === 'recording') void recorder.stop();
  };

  // The ⚠ 第 N 段未轉寫・重試 marker is the retry button.
  const onDocumentClick = (event: MouseEvent<HTMLDivElement>) => {
    const gap = event.target instanceof Element ? event.target.closest('[data-transcript-gap]') : null;
    const gapId = gap?.getAttribute('data-transcript-gap');
    if (!gapId) return;
    event.preventDefault();
    if (recorder.state === 'needsSetup') setSettingsOpen(true);
    else void recorder.retryGap(gapId);
  };

  return (
    <div className="oc-app" data-drawer-open={drawerOpen ? 'true' : 'false'}>
      <aside className="oc-sidebar" id="oc-sidebar">
        <NoteList
          notes={notes}
          activeId={activeNote.id}
          disabled={recording}
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
          <ActionBar
            recordState={recorder.state}
            onRecord={onRecord}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </header>
        <Banner />
        {(recorder.error || recorder.notice) && (
          <div className="oc-recorder-alert" role="alert">
            <div className="oc-recorder-alert-text">
              {recorder.error && <p className="oc-recorder-error">{recorder.error}</p>}
              {recorder.notice && <p className="oc-recorder-notice">{recorder.notice}</p>}
            </div>
            <button
              type="button"
              className="oc-alert-close"
              aria-label="關閉訊息"
              onClick={recorder.dismissMessages}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        <Toolbar editor={editor} note={activeNote} />
        <div className="oc-document" onClick={onDocumentClick}>
          <TitleInput
            value={activeNote.title}
            onChange={(title) => updateActive({ title })}
            onEnter={() => editor.commands.focus('start')}
          />
          <Editor editor={editor} />
        </div>
      </main>

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onSave={(next) => {
            saveSettings(next);
            setSettingsOpen(false);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
```

`useRecorder` 與 `useNoteEditor` 一樣必須在 early return 之前呼叫（hooks 規則）；載入期間 `noteId` 為 `undefined`，`start()` 不會動作。

- [ ] **Step 11: 加入樣式**

在 `packages/core/src/styles/app.css` 的 `/* ---------- narrow screens: note list becomes a drawer ---------- */` 這行註解**之前**插入：

```css
/* ---------- recording ---------- */
.oc-actionbar-end {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.oc-settings-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--oc-border);
  border-radius: 50%;
  background: var(--oc-bg);
  color: var(--oc-muted);
  cursor: pointer;
}

.oc-settings-btn:hover {
  border-color: var(--oc-primary);
  color: var(--oc-primary);
}

.oc-record-btn.is-recording {
  background: var(--oc-danger);
  animation: oc-pulse 1.5s ease-in-out infinite;
}

@keyframes oc-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.45);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(220, 38, 38, 0);
  }
}

.oc-spin {
  animation: oc-spin 1s linear infinite;
}

@keyframes oc-spin {
  to {
    transform: rotate(360deg);
  }
}

.oc-recorder-alert {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 12px 16px 0;
  padding: 10px 14px;
  border: 1px solid #fde68a;
  border-radius: var(--oc-radius);
  background: #fffbeb;
  font-size: 14px;
}

.oc-recorder-alert-text {
  flex: 1;
}

.oc-recorder-alert p {
  margin: 0;
}

.oc-recorder-error {
  color: var(--oc-danger);
}

.oc-recorder-notice {
  color: #92400e;
}

.oc-alert-close {
  display: inline-flex;
  padding: 2px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--oc-muted);
  cursor: pointer;
}

.oc-editor .ProseMirror .oc-gap {
  display: inline-block;
  margin: 0 2px;
  padding: 0 8px;
  border-radius: 999px;
  background: #fef3c7;
  color: #b45309;
  font-size: 0.9em;
  line-height: 1.6;
  cursor: pointer;
  user-select: none;
}

.oc-editor .ProseMirror .oc-gap:hover {
  background: #fde68a;
}

.oc-editor .ProseMirror .oc-gap.ProseMirror-selectednode {
  outline: 2px solid var(--oc-primary);
}

.oc-icon-btn:disabled,
.oc-note-select:disabled,
.oc-note-delete:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* ---------- settings dialog ---------- */
.oc-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(17, 24, 39, 0.4);
}

.oc-dialog {
  width: min(440px, 100%);
  padding: 20px;
  border-radius: var(--oc-radius);
  background: var(--oc-bg);
  box-shadow: 0 16px 48px rgba(17, 24, 39, 0.2);
}

.oc-dialog-title {
  margin: 0 0 16px;
  font-size: 18px;
}

.oc-dialog-form {
  display: grid;
  gap: 8px;
}

.oc-dialog-form label {
  font-size: 14px;
  font-weight: 600;
}

.oc-dialog-form input {
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--oc-border);
  border-radius: 8px;
  font: inherit;
}

.oc-dialog-form input:focus {
  border-color: var(--oc-primary);
  outline: none;
}

.oc-dialog-hint {
  margin: 0;
  color: var(--oc-muted);
  font-size: 13px;
}

.oc-dialog-test {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
}

.oc-dialog-message {
  margin: 0;
  color: var(--oc-muted);
  font-size: 13px;
}

.oc-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.oc-primary-btn {
  height: 32px;
  padding: 0 18px;
  border: none;
  border-radius: 999px;
  background: var(--oc-gradient);
  color: #ffffff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
```

齒輪鈕與 AI 鈕包在 `.oc-actionbar-end` 內，窄螢幕時跟著 `.oc-actionbar` 換行。設定對話框以 `min(440px, 100%)` 加 16px 外距，320px 寬也完整顯示。

- [ ] **Step 12: 執行元件測試與型別檢查，確認通過**

Run: `npm test -w @oc/core -- src/components/ActionBar.test.tsx src/components/NoteList.test.tsx src/NotesApp.test.tsx src/NotesApp.recording.test.tsx && npm run typecheck -w @oc/core`
Expected: `Test Files  4 passed (4)`、`Tests  30 passed (30)`；typecheck 無錯誤；輸出中沒有 `stderr`、`not wrapped in act(...)` 或 `Unhandled Errors`。

- [ ] **Step 13: 執行全部端對端測試，確認通過**

Run: `npm run e2e -w @oc/web`
Expected: `11 passed`（M1 的 4 個 + M2 的 5 個 + 本計畫的 2 個）。錄音的兩個測試各需約 15–25 秒（等第一次切段 4–8 秒，第二個測試另有 1+2+4 秒的重試）。

- [ ] **Step 14: Commit**

```bash
git add packages/core/src/components/ActionBar.tsx packages/core/src/components/ActionBar.test.tsx packages/core/src/components/NoteList.tsx packages/core/src/components/NoteList.test.tsx packages/core/src/NotesApp.tsx packages/core/src/NotesApp.test.tsx packages/core/src/NotesApp.recording.test.tsx packages/core/src/styles/app.css apps/web/e2e/recording.spec.ts
git commit -m "feat(core): wire recording, settings and transcript gaps into the app"
```

---

### Task 16: Verification（整體驗證）

**Files:** 無新增或修改。

- [ ] **Step 1: 全部單元與元件測試**

Run: `npm test`
Expected:
- `@oc/core`：`Test Files  46 passed (46)`、`Tests  296 passed (296)`
- `@oc/shared`：`Test Files  1 passed (1)`、`Tests  3 passed (3)`
- `@oc/web`：`Test Files  1 passed (1)`、`Tests  1 passed (1)`
- `@oc/api`（M3a）：`Test Files  9 passed (9)`、`Tests  49 passed (49)`（本計畫未修改，數字以 M3a 計畫為準）

`@oc/core`、`@oc/shared`、`@oc/web` 的輸出中不應出現 `stderr`、`not wrapped in act(...)` 或 `Unhandled Errors`；任何工作區都不應出現 `failed`。

- [ ] **Step 2: 全部型別檢查**

Run: `npm run typecheck`
Expected: 每個 workspace 的 `tsc --noEmit` 皆無錯誤輸出。

- [ ] **Step 3: 端對端測試（重複 3 次確認穩定）**

Run: `npm run e2e -w @oc/web -- --repeat-each=3`
Expected: `33 passed`

- [ ] **Step 4: 正式建置**

Run: `npm run build -w @oc/web`
Expected: `✓ built in`；`dist/assets/index-*.js` 約 686 kB（gzip 約 221 kB），`toDocx-*.js` 約 365 kB；**沒有** `Some chunks are larger than 1000 kB` 警告。

- [ ] **Step 5: 人工檢查（真的後端與麥克風）**

準備 M3a 後端：把 `apps/api/.env.example` 複製成 `apps/api/.env`，填入真的 `OPENAI_API_KEY`，`ACCESS_KEYS=dev-key`（範例檔的 `ALLOWED_ORIGINS` 已含 `http://localhost:5173`，保留即可）。開兩個 Git Bash：

Run: `(unset OPENAI_API_KEY ACCESS_KEYS ALLOWED_ORIGINS PORT; npm run dev -w @oc/api)`
Expected: 伺服器在 `http://localhost:8787` 啟動（先 `unset` 是 M3a 的建議：避免 shell 裡同名的環境變數蓋過 `.env`）。

Run: `npm run dev -w @oc/web`，用 Chrome 開 `http://localhost:5173`，逐項確認：

- [ ] 沒有設定時錄製鈕顯示「請先設定」，按下開啟「設定」對話框；齒輪鈕（AI 鈕右側）也能開啟。
- [ ] 後端網址填 `http://localhost:8787`、按「測試連線」顯示「連線成功」；填 `http://localhost:9`（沒有服務）顯示「連線失敗，請確認後端網址」；填 `localhost:8787` 按「儲存」顯示「請輸入 http:// 或 https:// 開頭的網址」。
- [ ] 存取金鑰填 `dev-key` 儲存後，錄製鈕變成「錄製」；重新整理後設定仍在（DevTools → Application → Local Storage → `oc.settings`）。
- [ ] 在內文中間點一下游標，按「錄製」：瀏覽器詢問麥克風權限，允許後按鈕變成紅色的「停止」，左側「新增筆記」、切換、刪除皆無法使用。
- [ ] 用中文連續說話約 30 秒（中間自然停頓）：每 4–8 秒在游標處出現一段繁體中文，順序與說話順序一致；同時在筆記其他位置打字，轉寫文字仍接在原插入點，不會跑到打字的地方。
- [ ] 按「停止」：按鈕短暫顯示「處理中」，最後一段插入後回到「錄製」，筆記清單恢復可用；DevTools Network 中每段 `/transcribe` 都是獨立的 `audio/webm` 檔（`segment-N.webm`），大小遠小於 5MB。
- [ ] 安靜不說話錄 10 秒：不會插入任何文字（空字串略過），錄製鈕照常運作。
- [ ] 錄音中把後端（執行 `npm run dev -w @oc/api` 的視窗）按 Ctrl+C 停掉：約 7 秒後該段變成黃色的「⚠ 第 N 段未轉寫・重試」；DevTools → Application → IndexedDB → `open-copilot` → `pendingSegments` 有對應的一筆。重新啟動後端、重新整理頁面，標記仍在；點擊標記後換成轉寫文字，`pendingSegments` 該筆消失。
- [ ] 再做出一個標記，在 DevTools Network 把節流設成「3G」後點擊標記，趁 `/transcribe` 還在 pending 時切到另一篇筆記：請求完成後出現「重新轉寫失敗，請稍後再試」，`pendingSegments` 該筆仍在。取消節流、切回原筆記點擊標記，即換成轉寫文字，該筆消失。
- [ ] 刪除一篇含「⚠ 第 N 段未轉寫・重試」標記的筆記：`pendingSegments` 中 `noteId` 為該筆記的列全部消失，其他筆記的列不受影響。
- [ ] 把設定中的存取金鑰改成 `wrong-key` 再錄音：第一段送出後錄音自動停止，出現「存取金鑰錯誤，請重新設定」並自動開啟設定頁；改回 `dev-key` 儲存後錯誤訊息消失，點擊該段標記即可補上。
- [ ] 在 Chrome 網址列左側的網站設定把麥克風改成「封鎖」，重新整理後按「錄製」：出現「無法使用麥克風，請在系統或瀏覽器設定中允許麥克風權限」，按「關閉訊息」可關掉。
- [ ] 錄音中拔掉 USB 麥克風（或在系統音訊設定停用麥克風）：出現「錄音已中斷，已錄的部分會照常轉寫」，已錄的部分照常插入。
- [ ] 錄出一個標記後匯出 Markdown／純文字／Word、按「複製」：標記處都是 `[未轉寫片段]`，沒有「⚠」。
- [ ] DevTools 裝置模式 390px 與 320px：錄製鈕、AI 鈕與齒輪換行後仍可點；設定對話框完整顯示在畫面內。
- [ ] DevTools Console 沒有錯誤或警告（停掉後端那一項預期會有網路錯誤）。

- [ ] **Step 6: 確認工作目錄乾淨**

Run: `git status --short -- . ':(exclude)docs/superpowers/plans'`
Expected: 沒有輸出（`apps/api/.env` 已被 `.gitignore` 忽略；計畫檔因勾選 checkbox 而變動是允許的，故排除）。
