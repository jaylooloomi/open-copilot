# M4 Electron 桌面版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把網頁版（`apps/web` 的 build 輸出）包成 Windows 桌面 App：以自訂協定 `app://bundle` 載入、筆記照樣存在 IndexedDB、匯出改用原生「另存新檔」對話框、麥克風錄音可用，並以 electron-builder 產出 NSIS 安裝檔。

**Architecture:** `apps/desktop` 是 CommonJS 的 Electron 殼：主程序把 `app://bundle/*` 對應到網頁 build 目錄（開發時 `apps/web/dist`，安裝後 `resources/web`），權限只開給自己的頁面（麥克風、寫入剪貼簿），以單一實例鎖確保同一份資料只有一個程序開啟，並以 IPC `oc:save-file` 提供原生存檔；preload 只暴露 `window.ocDesktop.saveFile`。網頁端只多一個轉接層：`selectPlatform()` 偵測到 `window.ocDesktop` 時改用 `createDesktopFileSaver`，`packages/core` 完全不動。可測的邏輯（路徑解析、權限政策、存檔流程、preload）都是純函式並有單元測試，整體行為由 Playwright `_electron` 端對端測試在開發版與安裝版上各跑一次。

**Tech Stack:** Electron 45、electron-builder 26（NSIS）、TypeScript 5.9（`tsc` 輸出 CommonJS）、Vitest 3（node 環境）、Playwright 1.64 `_electron`、網頁端沿用 M1–M3b 的 React 19／Vite 7／Vitest 3 + jsdom。

---

## 前置條件

- 在 repo 根目錄 `D:\git\open-copilot` 以 **Git Bash** 執行所有指令。Windows 11、Node 24、npm 11。
- M1（`2026-10-21-m1-web-editor.md`）、M2（`2026-10-21-m2-export-copy.md`）、M3a（`2026-10-21-m3a-transcribe-api.md`）、M3b（`2026-10-21-m3b-web-recording.md`）已全部完成並 commit。本計畫的「修改」步驟以這些計畫產出的檔案為準：`apps/web/src/platform/selectPlatform.ts`／`selectPlatform.test.ts` 與根目錄 `.gitignore` 都是 M1 的內容（M2、M3a、M3b 沒有改過它們）。
- 需要網路：第一次下載 Electron 執行檔（約 110 MB，存到 `%LOCALAPPDATA%\electron\Cache`）；第一次 `npm run dist` 時 electron-builder 會再下載 Electron zip、NSIS 與 7-Zip（存到 `%LOCALAPPDATA%\electron-builder\Cache`）。
- 桌面版端對端測試會開出真正的 Electron 視窗（不是 headless），並會寫入系統剪貼簿；執行期間不要操作滑鼠鍵盤。
- 本計畫的程式碼已在這台機器上實際跑過：以 M1＋M2＋M3b 計畫產出的程式碼為基礎（該份重播早於 M3b 審閱後的最後修訂，所以 `@oc/core` 當時是 291 個測試；本計畫引用的 296 以 M3b 計畫為準），每個 Task 的「先失敗、後通過」、四個 workspace 的 typecheck、`vite build`、桌面版 e2e（開發版 `--repeat-each=3` 與安裝版各一次）、網頁版 e2e 全部通過。實際版本：electron 45.0.0、electron-builder 26.15.3、@playwright/test 1.64.1、vitest 3.2.7、typescript 5.9.3、vite 7.3.7。審閱後加入的單一實例鎖與開發版獨立資料夾（`main.ts`）、「立刻關閉」與「再啟動一次」兩個 e2e、改寫後的「取消」e2e、`electron.launch` 的 15 秒逾時，也在同一份重播上跑過（開發版 `--repeat-each=3` 與安裝版各一次），並確認新測試在拿掉對應實作時會失敗。那一次重播時這台機器的系統剪貼簿無法使用（PowerShell 的 `Set-Clipboard` 後 `Get-Clipboard` 也讀不到），「複製」測試因此失敗；改回審閱前的 `main.ts` 與測試檔同樣失敗，與本次修改無關，更早的重播中該測試通過。Verification 的手動檢查表（真麥克風、真的存檔與列印對話框）沒有自動化，必須由人執行。

- [ ] **前置步驟 1：確認 M1–M3b 已完成**

Run: `npm test -w @oc/core`
Expected: `Test Files  46 passed (46)`、`Tests  296 passed (296)`（以 M3b 計畫為準）。

Run: `ls packages/core/src/recording/useRecorder.ts packages/core/src/editor/NoteActions.tsx apps/web/e2e/recording.spec.ts apps/api/src/app.ts`
Expected: 四個檔案都列出，沒有 `No such file or directory`。

- [ ] **前置步驟 2：commit 計畫文件**

Run: `git status --short`
Expected: 沒有輸出，或只有 `docs/superpowers/plans/` 底下的變動（例如本計畫檔 `?? docs/superpowers/plans/2026-10-21-m4-electron-desktop.md`，或勾選 checkbox 造成的修改）。若出現其他路徑，先停下來回報。

若有 `docs/superpowers/plans/` 的變動：

```bash
git add docs/superpowers/plans
git commit -m "docs: add M4 Electron desktop plan"
```

Run: `git status --short`
Expected: 沒有輸出。

## 與共用契約的關係（下游計畫必讀）

本計畫遵守 `2026-10-21-00-overview.md` 的「桌面（M4）」與 `selectPlatform`／`desktopFileSaver`／`global.d.ts` 簽章。下表是契約沒有寫死、由本計畫決定（或因實測而必須偏離）的細節，M5 撰寫時請以此為準：

| 項目 | 決定 |
|---|---|
| Vite `base` | **維持預設 `/`，`apps/web/vite.config.ts` 不修改。** `app` 以 `standard: true` 註冊後有真正的 host（`bundle`），build 輸出中的 `/assets/index-*.js`、動態載入的 `/assets/toDocx-*.js` 都解析成 `app://bundle/assets/...`，再由 `resolveAppPath` 對應到網頁 build 目錄；網頁正式部署（Vercel／Cloudflare Pages）與 M5 Capacitor（`https://localhost/`）也都從網域根目錄提供檔案，所以三端共用同一份 build。e2e 的「匯出 Word」測試實際載入了 `toDocx` 分塊，證明動態 chunk 在 `app://` 下可用。 |
| 權限（**偏離原契約，Task 2 Step 6 改寫契約**） | 原契約寫「`setPermissionRequestHandler` 只允許 `media`」。實測 Electron 45 在 M2 的「複製」（`navigator.clipboard.write`）時會送出 `clipboard-sanitized-write` 權限請求，拒絕後狀態列顯示「複製失敗，請再試一次」。因此 `shouldGrantPermission` 允許：來自 `app://bundle` 的 `media`（`mediaTypes` 不含 `video`，即只有麥克風）與 `clipboard-sanitized-write`；其餘（含 `clipboard-read`、相機、`local-network-access`）一律拒絕。契約規定子計畫與總覽衝突時「以本檔為準並回報」，所以 Task 2 Step 6 把總覽 §4「桌面（M4）」的 `main.ts` 條目改成同樣的政策並單獨 commit，執行者完成 Task 2 時必須向使用者回報這項契約變更。 |
| 權限政策位置 | `apps/desktop/src/security.ts`：`shouldGrantPermission(permission, details)`、`isExternalHttpUrl(url)`；`PermissionDetails` 只取 `requestingUrl`、`mediaTypes`。 |
| `appProtocol.ts` 額外匯出 | `APP_SCHEME = 'app'`、`APP_HOST = 'bundle'`、`APP_ORIGIN = 'app://bundle'`、`APP_ENTRY_URL = 'app://bundle/index.html'`、`isAppUrl(url)`。`resolveAppPath` 先 `decodeURIComponent`，含 `\`、`:`、NUL 的路徑一律拒絕，再以 `path.relative` 確認仍在 root 內；`/` 與空路徑對應 `index.html`；查詢字串與 `#` 忽略；找不到檔案時 `protocol.handle` 回 404。 |
| IPC `oc:save-file` | 常數 `SAVE_FILE_CHANNEL`（`apps/desktop/src/saveFile.ts`）。主程序先確認 `event.senderFrame.url` 是 `app://bundle` 頁面，再交給 `createSaveFileHandler`：檔名只取 `basename`（renderer 只能建議檔名，不能指定資料夾），對話框標題「另存新檔」、預設資料夾為「文件」，篩選器 `Markdown`／`Word 文件`／`純文字` + `所有檔案`；取消回 `false`、寫入成功回 `true`、參數型別不對或寫檔失敗則丟錯（renderer 端顯示「匯出失敗，請再試一次」）。 |
| `OcDesktopBridge` | 型別定義在 `apps/web/src/platform/desktopFileSaver.ts`（`saveFile(filename: string, bytes: Uint8Array): Promise<boolean>`），`apps/web/src/global.d.ts` 以它宣告 `window.ocDesktop?`。sandbox 中的 preload 只能 `require('electron')`，所以 `preload.ts` 不 import 本地模組，channel 名稱重寫一次並由 `preload.test.ts` 比對。 |
| 取消存檔 | 依 M2 約定：`saveFile` 回 `false` 時 `createDesktopFileSaver` 以 `new DOMException('使用者取消', 'AbortError')` reject，`NoteActions` 不顯示訊息。 |
| `selectPlatform` 結構 | `selectPlatform()` 仍無參數；檔案存取由內部的 `selectFileSaver()` 決定（`window.ocDesktop` 存在 → 桌面版，否則瀏覽器下載）；`canPrint` 兩者皆為 `true`。M5 加 Capacitor 分支時，建議在 `selectFileSaver` 與 `canPrint` 各加一個 `Capacitor.isNativePlatform()` 判斷，並沿用 `selectPlatform.test.ts` 的 `afterEach(() => { delete window.ocDesktop; ... })` 模式。 |
| 版本固定 | `electron`、`electron-builder` 以 `npm install -D -E` 寫入**確切版本**（不帶 `^`）。electron 被 hoist 到根目錄 `node_modules` 時，electron-builder 只接受固定版本，否則報 `Electron version "^45.0.0" is a range, not a fixed version`。 |
| Electron 執行檔 | Electron 45 的 npm 套件不在 `npm install` 時下載執行檔（第一次 `require('electron')` 才下載）。Task 1 以 `npm exec -w @oc/desktop -- install-electron` 明確下載。 |
| 使用者資料夾 | `package.json` 的 `productName: "open-copilot"` → `app.getName()` 為 `open-copilot`，安裝版的 IndexedDB／localStorage 在 `%APPDATA%\open-copilot`。開發版（`app.isPackaged` 為 false，即 `npm run dev`）改用 `%APPDATA%\open-copilot-dev`，開發時永遠不會開啟或鎖住安裝版的真實筆記。環境變數 `OC_USER_DATA_DIR` 優先於兩者，e2e 每個測試都用全新的暫存資料夾。 |
| 單一實例 | `main.ts` 在設定好 userData 之後呼叫 `app.requestSingleInstanceLock()`：拿不到鎖就 `app.quit()`（exit code 0）；拿到鎖的實例在 `second-instance` 時把既有視窗還原並帶到前面。鎖以 userData 資料夾為單位，所以 e2e 每個暫存資料夾各自一把鎖，開發版與安裝版也可同時開著。沒有這把鎖時，同一個資料夾的第二個程序會讓 IndexedDB 開不起來（`openAppDb()` reject，視窗空白），或兩個視窗各自以 500ms debounce 寫入整篇筆記而互相覆蓋。 |
| 背景節流 | `webPreferences.backgroundThrottling: false`：視窗最小化時 M3b 的切段計時器（每 50ms 取樣）不會被降到每秒一次，錄音照常 4–8 秒切段上傳。 |
| 外部連結 | Tiptap Link 點擊時呼叫 `window.open`；`setWindowOpenHandler` 把 http(s) 交給 `shell.openExternal` 並一律 `deny`；`will-navigate` 擋下離開 `app://bundle` 的導覽。 |
| CORS | 實測從 `app://bundle` 發出的請求帶 `Origin: app://bundle`，與 M3a 的 `ALLOWED_ORIGINS` 預設值一致；連到 `http://localhost:8787` 不會觸發 Local Network Access 權限請求。 |
| 列印 | Electron 的 `print()` 直接開 Windows 系統列印對話框（沒有 Chrome 的預覽），且對話框開著時 renderer 會被阻塞，無法以 Playwright 自動化，改列在手動檢查表。 |
| 打包 | `electron-builder.yml` 必須有 `publish: null`：沒有 repository 時 electron-builder 26.15.3 會在產生更新資訊時崩潰（`Cannot read properties of null (reading 'channel')`）。輸出目錄 `apps/desktop/release/` 加入根 `.gitignore`。尚未設計 App 圖示，使用 Electron 預設圖示；安裝檔未簽章，SmartScreen 會警告。 |
| 測試指令 | 根目錄 `npm test`／`npm run typecheck` 會包含 `@oc/desktop`（單元測試在 node 環境，不需要 Electron）。桌面版 e2e 另外以 `npm run e2e -w @oc/desktop` 執行；根目錄 `npm run e2e` 仍只跑網頁版。 |

本計畫新增的**開發**依賴：`apps/desktop` 的 `electron`、`electron-builder`（契約已列）與 `@playwright/test`（與 `apps/web` 同版本，npm 會共用）。沒有新增任何執行期套件。

## File Structure

| 檔案 | 動作 | 單一職責 |
|---|---|---|
| `apps/desktop/package.json` | Create | `@oc/desktop`（CommonJS、`main: dist/main.js`、`productName`）、scripts `build`／`dev`／`dist`／`test`／`typecheck`／`e2e`、固定版本的 electron／electron-builder |
| `apps/desktop/tsconfig.json` | Create | 型別檢查設定（src、e2e、設定檔；沿用 base 的 bundler resolution） |
| `apps/desktop/tsconfig.build.json` | Create | `tsc` 輸出：`src` → `dist/`，NodeNext（CommonJS），排除測試 |
| `apps/desktop/vitest.config.mts` | Create | 單元測試設定（node 環境，只收 `src/**/*.test.ts`） |
| `apps/desktop/src/appProtocol.ts` | Create | `app://bundle` 常數、`resolveAppPath`（擋路徑穿越）、`isAppUrl` |
| `apps/desktop/src/security.ts` | Create | 權限政策 `shouldGrantPermission`、外部連結判斷 `isExternalHttpUrl` |
| `apps/desktop/src/saveFile.ts` | Create | `SAVE_FILE_CHANNEL`、`createSaveFileHandler`：參數檢查、原生對話框、寫檔 |
| `apps/desktop/src/preload.ts` | Create | `contextBridge` 暴露 `window.ocDesktop.saveFile` |
| `apps/desktop/src/main.ts` | Create | 選定使用者資料夾、單一實例鎖、註冊協定、權限、IPC，建立視窗與連結處理 |
| `apps/desktop/playwright.config.ts` | Create | 桌面版 e2e 設定（單一 worker） |
| `apps/desktop/e2e/app.spec.ts` | Create | Electron 端對端測試：載入、保存（含輸入後立刻關閉）、單一實例、匯出、取消、複製、連結、麥克風 |
| `apps/desktop/electron-builder.yml` | Create | Windows NSIS 安裝檔；`extraResources` 把 `../web/dist` 放到 `resources/web` |
| `apps/web/src/platform/desktopFileSaver.ts` | Create | `OcDesktopBridge` 型別、`createDesktopFileSaver`（Blob → bytes → IPC，取消轉成 AbortError） |
| `apps/web/src/global.d.ts` | Create | 宣告 `window.ocDesktop?: OcDesktopBridge` |
| `apps/web/src/platform/selectPlatform.ts` | Modify | 在 Electron 內改用桌面版 FileSaver |
| `apps/web/src/platform/selectPlatform.test.ts` | Modify | 加測桌面分支與瀏覽器分支 |
| `.gitignore` | Modify | 忽略 `apps/desktop/release/` |
| `package-lock.json` | Modify | 新 workspace 與 electron、electron-builder |
| `docs/superpowers/plans/2026-10-21-00-overview.md` | Modify | 契約 §4「桌面（M4）」的權限政策改為 `media`（僅麥克風）+ `clipboard-sanitized-write` |

每個 `src/*.ts` 旁邊的 `*.test.ts` 為其測試（`main.ts` 由 e2e 涵蓋）。

---

### Task 1: `@oc/desktop` 骨架與 `resolveAppPath`

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/tsconfig.build.json`
- Create: `apps/desktop/vitest.config.mts`
- Create: `apps/desktop/src/appProtocol.ts`
- Test: `apps/desktop/src/appProtocol.test.ts`
- Modify: `package-lock.json`

- [ ] **Step 1: 建立套件設定並安裝**

`apps/desktop/package.json`（electron 與 electron-builder 在 Step 2 由 npm 寫入）：

```json
{
  "name": "@oc/desktop",
  "version": "0.1.0",
  "private": true,
  "productName": "open-copilot",
  "description": "open-copilot 語音筆記桌面版",
  "author": "open-copilot",
  "type": "commonjs",
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "npm run build -w @oc/web && npm run build && electron .",
    "dist": "npm run build -w @oc/web && npm run build && electron-builder --win --publish never",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "e2e": "npm run build -w @oc/web && npm run build && playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.64.1"
  }
}
```

說明：`version` 用 `0.1.0` 是安裝檔的版本號（`open-copilot-setup-0.1.0.exe`）；`description`、`author` 是 electron-builder 要求的欄位。`dev`、`dist`、`e2e` 都先建置網頁版，因為主程序從 `apps/web/dist` 讀取網頁。在 `apps/desktop` 內呼叫 `npm run build -w @oc/web` 可行：npm 會往上找到 workspace 根目錄。

`apps/desktop/tsconfig.json`（型別檢查用；沿用 base 的 `moduleResolution: bundler`，Vitest 與 Playwright 的型別都能解析）：

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "e2e", "playwright.config.ts", "vitest.config.mts"]
}
```

`apps/desktop/tsconfig.build.json`（建置用：Electron 主程序與 preload 需要 CommonJS；`package.json` 是 `"type": "commonjs"`，NodeNext 會輸出 `require()`）：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

`apps/desktop/vitest.config.mts`（副檔名用 `.mts`：套件是 CommonJS，`.mts` 讓 Vite 一定以 ESM 載入設定檔）：

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // e2e/*.spec.ts belong to Playwright.
    include: ['src/**/*.test.ts'],
  },
});
```

Run: `npm install`
Expected: 成功；`node_modules/@oc/desktop` 連到 `apps/desktop`。

- [ ] **Step 2: 安裝 Electron 與 electron-builder（固定版本）並下載執行檔**

Run: `npm install -D -E -w @oc/desktop electron@latest electron-builder@latest`
Expected: 成功；`apps/desktop/package.json` 的 `devDependencies` 變成（版本為安裝當下的最新版；撰寫本計畫時如下）：

```json
  "devDependencies": {
    "@playwright/test": "^1.64.1",
    "electron": "45.0.0",
    "electron-builder": "26.15.3"
  }
```

`-E`（`--save-exact`）是必要的：electron 會被 hoist 到根目錄 `node_modules`，electron-builder 在 `apps/desktop` 找不到它時只接受固定版本（見「與共用契約的關係」）。

Run: `npm exec -w @oc/desktop -- install-electron`
Expected: exit code 0，`node_modules/electron/dist/electron.exe` 存在（第一次會下載約 110 MB 並解壓；已在快取中時幾秒內結束且沒有輸出）。Electron 45 的 npm 套件不在安裝時下載執行檔，所以這一步不能省。

Run: `npm exec -w @oc/desktop -- electron --version && npm exec -w @oc/desktop -- electron-builder --version`
Expected: `v45.0.0` 與 `26.15.3`。若主版本較新，照用即可；之後 Expected 中出現的 `electron=45.0.0` 等版本字樣以實際版本為準。

- [ ] **Step 3: 寫失敗的測試**

`apps/desktop/src/appProtocol.test.ts`：

```ts
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_ENTRY_URL, APP_ORIGIN, isAppUrl, resolveAppPath } from './appProtocol';

const root = path.resolve('fixtures', 'web');
const inRoot = (...segments: string[]) => path.join(root, ...segments);

describe('resolveAppPath', () => {
  it('serves index.html for the root URL', () => {
    expect(resolveAppPath('app://bundle/', root)).toBe(inRoot('index.html'));
    expect(resolveAppPath('app://bundle', root)).toBe(inRoot('index.html'));
    expect(resolveAppPath(APP_ENTRY_URL, root)).toBe(inRoot('index.html'));
  });

  it('maps Vite asset paths into the root', () => {
    expect(resolveAppPath('app://bundle/assets/index-B1x2.js', root)).toBe(
      inRoot('assets', 'index-B1x2.js'),
    );
    expect(resolveAppPath('app://bundle/assets/toDocx-C3d4.js', root)).toBe(
      inRoot('assets', 'toDocx-C3d4.js'),
    );
  });

  it('ignores query strings and fragments', () => {
    expect(resolveAppPath('app://bundle/index.html?v=2#top', root)).toBe(inRoot('index.html'));
    expect(resolveAppPath('app://bundle/?from=test', root)).toBe(inRoot('index.html'));
    expect(resolveAppPath('app://bundle/assets/app.css?inline', root)).toBe(inRoot('assets', 'app.css'));
  });

  it('decodes percent-encoded paths', () => {
    expect(resolveAppPath('app://bundle/assets/%E4%B8%AD%E6%96%87%20%E5%AD%97%E5%9E%8B.woff2', root)).toBe(
      inRoot('assets', '中文 字型.woff2'),
    );
  });

  it('blocks path traversal, including encoded separators', () => {
    for (const url of [
      'app://bundle/..%2F..%2Fsecret.txt',
      'app://bundle/assets/..%2F..%2F..%2Fsecret.txt',
      'app://bundle/..%5C..%5Csecret.txt',
      'app://bundle/assets%2F..%2F..%2Fsecret.txt',
      'app://bundle/%2E%2E%2Fsecret.txt',
    ]) {
      expect(resolveAppPath(url, root), url).toBeNull();
    }
  });

  it('keeps dot segments that the URL parser normalizes inside the root', () => {
    expect(resolveAppPath('app://bundle/../../secret.txt', root)).toBe(inRoot('secret.txt'));
    expect(resolveAppPath('app://bundle/%2e%2e/%2e%2e/secret.txt', root)).toBe(inRoot('secret.txt'));
  });

  it('rejects backslashes, drive letters, NUL bytes and malformed encoding', () => {
    expect(resolveAppPath('app://bundle/assets%5Cindex.js', root)).toBeNull();
    expect(resolveAppPath('app://bundle/C:/Windows/win.ini', root)).toBeNull();
    expect(resolveAppPath('app://bundle/index.html%00.js', root)).toBeNull();
    expect(resolveAppPath('app://bundle/%E4%B8', root)).toBeNull();
  });

  it('rejects other hosts, other schemes and non-URLs', () => {
    expect(resolveAppPath('app://evil/index.html', root)).toBeNull();
    expect(resolveAppPath('https://bundle/index.html', root)).toBeNull();
    expect(resolveAppPath('file:///C:/Windows/win.ini', root)).toBeNull();
    expect(resolveAppPath('not a url', root)).toBeNull();
  });
});

describe('isAppUrl', () => {
  it('accepts only pages on app://bundle', () => {
    expect(APP_ORIGIN).toBe('app://bundle');
    expect(isAppUrl('app://bundle/index.html')).toBe(true);
    expect(isAppUrl('app://bundle/')).toBe(true);
    expect(isAppUrl('app://other/index.html')).toBe(false);
    expect(isAppUrl('https://example.com/')).toBe(false);
    expect(isAppUrl('')).toBe(false);
  });
});
```

說明：WHATWG URL 解析器本身會把 `..`、`%2e%2e` 這類點區段正規化掉（第 6 個測試），真正的危險是**編碼過的分隔符**（`%2F`、`%5C`）在 `decodeURIComponent` 之後才出現；第 5、7 個測試鎖住這些情況。`assets%5Cindex.js` 這個案例在 Windows 上解碼後仍落在 root 內，只有「拒絕反斜線」規則能擋住，所以它確保該規則在每個平台都生效。

- [ ] **Step 4: 執行測試，確認失敗**

Run: `npm test -w @oc/desktop -- src/appProtocol.test.ts`
Expected: FAIL，`Error: Cannot find module './appProtocol' imported from '.../apps/desktop/src/appProtocol.test.ts'`（node 環境下 Vitest 的訊息；另有一行 `Caused by: Error: Failed to load url ./appProtocol ... Does the file exist?`）。

- [ ] **Step 5: 實作**

`apps/desktop/src/appProtocol.ts`：

```ts
import * as path from 'node:path';

export const APP_SCHEME = 'app';
export const APP_HOST = 'bundle';
/** The renderer's origin; the backend's CORS list (M3a ALLOWED_ORIGINS) contains it. */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

/** Characters no file in the web build uses; rejecting them blocks `\..\`, drive letters and NUL. */
const FORBIDDEN = /[\\:\0]/;

/**
 * Maps an app://bundle/... request to a file inside `rootDir`, or null when the URL is not ours,
 * is malformed, or would escape `rootDir`. Query strings and fragments are ignored.
 */
export function resolveAppPath(requestUrl: string, rootDir: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null; // malformed percent-encoding
  }
  if (pathname === '' || pathname === '/') pathname = '/index.html';
  if (FORBIDDEN.test(pathname)) return null;

  const root = path.resolve(rootDir);
  const filePath = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, filePath);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  return filePath;
}

/** True for pages served by our own protocol (used to trust IPC senders and permission requests). */
export function isAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST;
  } catch {
    return false;
  }
}
```

注意 `FORBIDDEN` 的字元類別裡是**兩個**反斜線（`[\\:\0]`，比對一個反斜線、冒號或 NUL）。

- [ ] **Step 6: 執行測試與型別檢查，確認通過**

Run: `npm test -w @oc/desktop -- src/appProtocol.test.ts && npm run typecheck -w @oc/desktop`
Expected: `Tests  9 passed (9)`；`tsc --noEmit` 無錯誤輸出。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/package.json apps/desktop/tsconfig.json apps/desktop/tsconfig.build.json apps/desktop/vitest.config.mts apps/desktop/src/appProtocol.ts apps/desktop/src/appProtocol.test.ts package-lock.json
git commit -m "feat(desktop): scaffold Electron app with app:// path resolver"
```

---

### Task 2: 權限與外部連結政策 `security.ts`

**Files:**
- Create: `apps/desktop/src/security.ts`
- Test: `apps/desktop/src/security.test.ts`
- Modify: `docs/superpowers/plans/2026-10-21-00-overview.md`（Step 6，契約同步）

- [ ] **Step 1: 寫失敗的測試**

`apps/desktop/src/security.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { isExternalHttpUrl, shouldGrantPermission } from './security';

const PAGE = 'app://bundle/index.html';

describe('shouldGrantPermission', () => {
  it('grants the microphone to app://bundle pages', () => {
    expect(shouldGrantPermission('media', { requestingUrl: PAGE, mediaTypes: ['audio'] })).toBe(true);
  });

  it('denies the camera, even together with the microphone', () => {
    expect(shouldGrantPermission('media', { requestingUrl: PAGE, mediaTypes: ['video'] })).toBe(false);
    expect(
      shouldGrantPermission('media', { requestingUrl: PAGE, mediaTypes: ['audio', 'video'] }),
    ).toBe(false);
  });

  it('grants clipboard writes (複製) but not clipboard reads', () => {
    expect(shouldGrantPermission('clipboard-sanitized-write', { requestingUrl: PAGE })).toBe(true);
    expect(shouldGrantPermission('clipboard-read', { requestingUrl: PAGE })).toBe(false);
  });

  it('denies everything to pages outside app://bundle', () => {
    expect(
      shouldGrantPermission('media', { requestingUrl: 'https://example.com/', mediaTypes: ['audio'] }),
    ).toBe(false);
    expect(shouldGrantPermission('media', { mediaTypes: ['audio'] })).toBe(false);
    expect(
      shouldGrantPermission('clipboard-sanitized-write', { requestingUrl: 'https://example.com/' }),
    ).toBe(false);
  });

  it('denies every other permission', () => {
    for (const permission of ['geolocation', 'notifications', 'openExternal', 'local-network-access', 'unknown']) {
      expect(shouldGrantPermission(permission, { requestingUrl: PAGE }), permission).toBe(false);
    }
  });
});

describe('isExternalHttpUrl', () => {
  it('accepts http and https links only', () => {
    expect(isExternalHttpUrl('https://example.com/a?b=1')).toBe(true);
    expect(isExternalHttpUrl('http://localhost:8787/health')).toBe(true);
    expect(isExternalHttpUrl('app://bundle/index.html')).toBe(false);
    expect(isExternalHttpUrl('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(isExternalHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isExternalHttpUrl('not a url')).toBe(false);
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/desktop -- src/security.test.ts`
Expected: FAIL，`Error: Cannot find module './security' imported from '.../apps/desktop/src/security.test.ts'`。

- [ ] **Step 3: 實作**

`apps/desktop/src/security.ts`：

```ts
import { isAppUrl } from './appProtocol';

/** The parts of Electron's permission request details that the policy looks at. */
export interface PermissionDetails {
  requestingUrl?: string;
  mediaTypes?: readonly string[];
}

/**
 * Our own pages get the microphone (recording) and clipboard writes (「複製」); everything else,
 * including the camera and reading the clipboard, is denied.
 */
export function shouldGrantPermission(permission: string, details: PermissionDetails): boolean {
  if (!isAppUrl(details.requestingUrl ?? '')) return false;
  if (permission === 'media') return !(details.mediaTypes ?? []).includes('video');
  return permission === 'clipboard-sanitized-write';
}

/** Links that may be handed to the system browser instead of opening inside the app. */
export function isExternalHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
```

`clipboard-sanitized-write` 是相對契約的必要偏離（見「與共用契約的關係」）：實測不允許時 M2 的「複製」在 Electron 中一律失敗。

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/desktop -- src/security.test.ts`
Expected: `Tests  6 passed (6)`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/security.ts apps/desktop/src/security.test.ts
git commit -m "feat(desktop): add permission and external link policy"
```

- [ ] **Step 6: 把權限政策寫回共用契約並回報**

總覽是有約束力的契約，原文只允許 `media`；本 Task 的政策多允許 `clipboard-sanitized-write`，所以要同步改寫契約，M5 與之後的審閱者才不會讀到互相矛盾的規定。

在 `docs/superpowers/plans/2026-10-21-00-overview.md` 的 §4「桌面（M4）」中，把這一整行：

```markdown
- `src/main.ts`：`protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])`；載入 `app://bundle/index.html`；`session.defaultSession.setPermissionRequestHandler` 只允許 `media`；`ipcMain.handle('oc:save-file', ...)` 用 `dialog.showSaveDialog` + `fs.promises.writeFile`。
```

換成：

```markdown
- `src/main.ts`：`protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])`；載入 `app://bundle/index.html`；`session.defaultSession.setPermissionRequestHandler` 只允許來自 `app://bundle` 的 `media`（僅麥克風，含 video 一律拒絕）與 `clipboard-sanitized-write`（M2「複製」需要），權限政策在 `src/security.ts` 的 `shouldGrantPermission`；`ipcMain.handle('oc:save-file', ...)` 用 `dialog.showSaveDialog` + `fs.promises.writeFile`。
```

Run: `grep -c "clipboard-sanitized-write" docs/superpowers/plans/2026-10-21-00-overview.md && grep -c "只允許 .media.；" docs/superpowers/plans/2026-10-21-00-overview.md`
Expected: 第一個 grep 輸出 `1`；第二個輸出 `0`（舊條文「只允許 `media`；」已不存在；grep 找不到時 exit code 為 1，屬正常）。

```bash
git add docs/superpowers/plans/2026-10-21-00-overview.md
git commit -m "docs: allow clipboard writes in desktop permission contract"
```

回報：契約規定子計畫與總覽衝突時「以本檔為準並回報」，因此完成本 Task 時要明確告訴使用者「已修改共用契約 §4 桌面（M4）的權限政策：除了麥克風，另允許 `clipboard-sanitized-write`，原因是 Electron 45 中 M2 的『複製』需要它」。

---

### Task 3: 原生存檔處理 `saveFile.ts`

**Files:**
- Create: `apps/desktop/src/saveFile.ts`
- Test: `apps/desktop/src/saveFile.test.ts`

- [ ] **Step 1: 寫失敗的測試**

對話框與寫檔都以 `vi.fn` 注入，測試不碰 Electron 也不碰磁碟。

`apps/desktop/src/saveFile.test.ts`：

```ts
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSaveFileHandler, SAVE_FILE_CHANNEL, type SaveDialogRequest } from './saveFile';

const DOCS = path.resolve('home', 'Documents');
const bytes = new TextEncoder().encode('# 週會紀錄\n');

function setup(result: { canceled: boolean; filePath?: string }) {
  const showSaveDialog = vi.fn(async (_request: SaveDialogRequest) => result);
  const writeFile = vi.fn(async (_filePath: string, _data: Uint8Array) => undefined);
  const saveFile = createSaveFileHandler({ showSaveDialog, writeFile, defaultDir: () => DOCS });
  return { saveFile, showSaveDialog, writeFile };
}

describe('createSaveFileHandler', () => {
  it('uses the oc:save-file channel', () => {
    expect(SAVE_FILE_CHANNEL).toBe('oc:save-file');
  });

  it('asks where to save, then writes the bytes there', async () => {
    const target = path.join(DOCS, '會議.md');
    const { saveFile, showSaveDialog, writeFile } = setup({ canceled: false, filePath: target });

    await expect(saveFile('週會紀錄.md', bytes)).resolves.toBe(true);

    expect(showSaveDialog).toHaveBeenCalledWith({
      title: '另存新檔',
      defaultPath: path.join(DOCS, '週會紀錄.md'),
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: '所有檔案', extensions: ['*'] },
      ],
    });
    expect(writeFile).toHaveBeenCalledWith(target, bytes);
  });

  it.each([
    ['報告.docx', 'Word 文件', 'docx'],
    ['筆記.txt', '純文字', 'txt'],
  ])('offers a matching file type filter for %s', async (filename, name, ext) => {
    const { saveFile, showSaveDialog } = setup({ canceled: true });
    await saveFile(filename, bytes);
    expect(showSaveDialog.mock.calls[0][0].filters[0]).toEqual({ name, extensions: [ext] });
  });

  it('returns false and writes nothing when the user cancels', async () => {
    const { saveFile, writeFile } = setup({ canceled: true, filePath: '' });
    await expect(saveFile('a.md', bytes)).resolves.toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('treats an empty path as cancelled', async () => {
    const { saveFile, writeFile } = setup({ canceled: false, filePath: '' });
    await expect(saveFile('a.md', bytes)).resolves.toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('keeps only the file name the renderer suggests', async () => {
    const { saveFile, showSaveDialog } = setup({ canceled: true });
    await saveFile('../../Windows/evil.md', bytes);
    await saveFile('..\\..\\Windows\\evil.md', bytes);
    expect(showSaveDialog).toHaveBeenCalledTimes(2);
    for (const [request] of showSaveDialog.mock.calls) {
      expect(request.defaultPath).toBe(path.join(DOCS, 'evil.md'));
    }
  });

  it('rejects arguments that did not come from desktopFileSaver', async () => {
    const { saveFile, showSaveDialog } = setup({ canceled: true });
    await expect(saveFile('', bytes)).rejects.toThrow('filename must be a non-empty string');
    await expect(saveFile(42, bytes)).rejects.toThrow('filename must be a non-empty string');
    await expect(saveFile('a.md', 'not bytes')).rejects.toThrow('bytes must be a Uint8Array');
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it('passes write failures on to the renderer', async () => {
    const { saveFile, writeFile } = setup({ canceled: false, filePath: path.join(DOCS, 'a.md') });
    writeFile.mockRejectedValueOnce(new Error('EACCES: permission denied'));
    await expect(saveFile('a.md', bytes)).rejects.toThrow('EACCES: permission denied');
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/desktop -- src/saveFile.test.ts`
Expected: FAIL，`Error: Cannot find module './saveFile' imported from '.../apps/desktop/src/saveFile.test.ts'`。

- [ ] **Step 3: 實作**

`apps/desktop/src/saveFile.ts`：

```ts
import * as path from 'node:path';

/** IPC channel between preload.ts and main.ts. */
export const SAVE_FILE_CHANNEL = 'oc:save-file';

export interface FileFilter {
  name: string;
  extensions: string[];
}

/** The subset of Electron's SaveDialogOptions we use. */
export interface SaveDialogRequest {
  title: string;
  defaultPath: string;
  filters: FileFilter[];
}

export interface SaveFileDeps {
  showSaveDialog(request: SaveDialogRequest): Promise<{ canceled: boolean; filePath?: string }>;
  writeFile(filePath: string, data: Uint8Array): Promise<void>;
  /** Folder the dialog opens in, e.g. app.getPath('documents'). */
  defaultDir(): string;
}

const FILTERS: Record<string, FileFilter> = {
  md: { name: 'Markdown', extensions: ['md'] },
  docx: { name: 'Word 文件', extensions: ['docx'] },
  txt: { name: '純文字', extensions: ['txt'] },
};
const ALL_FILES: FileFilter = { name: '所有檔案', extensions: ['*'] };

/**
 * Handles `oc:save-file`: asks where to save with the native dialog, then writes the bytes.
 * Resolves true when written and false when the user cancels; invalid arguments throw.
 */
export function createSaveFileHandler(deps: SaveFileDeps) {
  return async function saveFile(filename: unknown, bytes: unknown): Promise<boolean> {
    if (typeof filename !== 'string' || filename.trim() === '') {
      throw new TypeError('filename must be a non-empty string');
    }
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('bytes must be a Uint8Array');
    }
    // The renderer only suggests a name; it never picks the folder.
    const name = path.basename(filename.replaceAll('\\', '/'));
    const filter = FILTERS[path.extname(name).slice(1).toLowerCase()];

    const result = await deps.showSaveDialog({
      title: '另存新檔',
      defaultPath: path.join(deps.defaultDir(), name),
      filters: filter ? [filter, ALL_FILES] : [ALL_FILES],
    });
    if (result.canceled || !result.filePath) return false;

    await deps.writeFile(result.filePath, bytes);
    return true;
  };
}
```

`SaveDialogRequest` 與回傳型別刻意寫成 Electron `SaveDialogOptions`／`SaveDialogReturnValue` 的子集（`filePath` 設為可省略），新舊版 Electron 的型別都能直接傳入。IPC 傳來的 `Uint8Array` 在主程序中仍是 `Uint8Array`（或其子類別 `Buffer`），`instanceof` 檢查成立。

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/desktop -- src/saveFile.test.ts`
Expected: `Tests  9 passed (9)`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/saveFile.ts apps/desktop/src/saveFile.test.ts
git commit -m "feat(desktop): add native save-file handler"
```

---

### Task 4: preload 暴露 `window.ocDesktop`

**Files:**
- Create: `apps/desktop/src/preload.ts`
- Test: `apps/desktop/src/preload.test.ts`

- [ ] **Step 1: 寫失敗的測試**

以 `vi.mock('electron', ...)` 取代 `contextBridge`／`ipcRenderer`，載入 preload 後檢查它暴露了什麼、`saveFile` 轉送到哪個 channel。

`apps/desktop/src/preload.test.ts`：

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SAVE_FILE_CHANNEL } from './saveFile';

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(async () => true) },
}));

type Bridge = { saveFile(filename: string, bytes: Uint8Array): Promise<boolean> };

describe('preload', () => {
  let bridge: Bridge;

  beforeAll(async () => {
    await import('./preload');
    bridge = vi.mocked(contextBridge.exposeInMainWorld).mock.calls[0][1] as Bridge;
  });

  it('exposes only saveFile, as window.ocDesktop', () => {
    expect(contextBridge.exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(vi.mocked(contextBridge.exposeInMainWorld).mock.calls[0][0]).toBe('ocDesktop');
    expect(Object.keys(bridge)).toEqual(['saveFile']);
  });

  it('forwards saveFile to the main process over oc:save-file', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(bridge.saveFile('筆記.md', bytes)).resolves.toBe(true);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(SAVE_FILE_CHANNEL, '筆記.md', bytes);
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/desktop -- src/preload.test.ts`
Expected: FAIL，`Error: Cannot find module './preload' imported from '.../apps/desktop/src/preload.test.ts'`，`Tests  2 skipped (2)`（`beforeAll` 失敗，兩個測試被略過）。

- [ ] **Step 3: 實作**

`apps/desktop/src/preload.ts`：

```ts
import { contextBridge, ipcRenderer } from 'electron';

// A sandboxed preload can only require('electron'), so the channel name is repeated here instead
// of being imported from saveFile.ts; preload.test.ts checks that both stay the same.
const SAVE_FILE_CHANNEL = 'oc:save-file';

contextBridge.exposeInMainWorld('ocDesktop', {
  saveFile: (filename: string, bytes: Uint8Array): Promise<boolean> =>
    ipcRenderer.invoke(SAVE_FILE_CHANNEL, filename, bytes),
});
```

- [ ] **Step 4: 執行全部桌面單元測試並確認建置結果**

Run: `npm test -w @oc/desktop`
Expected: `Test Files  4 passed (4)`、`Tests  26 passed (26)`。

Run: `npm run build -w @oc/desktop && ls apps/desktop/dist`
Expected: `appProtocol.js  preload.js  saveFile.js  security.js`（沒有 `*.test.js`；`main.js` 在 Task 7 才出現）。

Run: `grep -c 'require("./' apps/desktop/dist/preload.js`
Expected: `0`（preload 沒有 require 任何本地模組，sandbox 中才能載入；grep 找不到時 exit code 為 1，屬正常）。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/preload.ts apps/desktop/src/preload.test.ts
git commit -m "feat(desktop): expose ocDesktop.saveFile from preload"
```

---

### Task 5: 網頁端 `createDesktopFileSaver` 與 `window.ocDesktop` 型別

**Files:**
- Create: `apps/web/src/platform/desktopFileSaver.ts`
- Create: `apps/web/src/global.d.ts`
- Test: `apps/web/src/platform/desktopFileSaver.test.ts`

- [ ] **Step 1: 寫失敗的測試**

jsdom 26 的 `Blob` 沒有 `arrayBuffer()`（M2 已記錄），測試改用 Node 內建的 `Blob`（`node:buffer`，與 M3b 的 `pendingQueue` 測試相同做法）；實作在 Electron 的 Chromium 中使用真正的 `Blob.arrayBuffer()`，由 Task 7 的 e2e 驗證。

`apps/web/src/platform/desktopFileSaver.test.ts`：

```ts
import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { createDesktopFileSaver, type OcDesktopBridge } from './desktopFileSaver';

/** jsdom's Blob has no arrayBuffer(); Node's Blob stands in for the browser Blob. */
const blobOf = (text: string) => new NodeBlob([text], { type: 'text/markdown' }) as unknown as Blob;

function fakeBridge(result: boolean | Error) {
  const saveFile = vi.fn(async (_filename: string, _bytes: Uint8Array) => {
    if (result instanceof Error) throw result;
    return result;
  });
  const bridge: OcDesktopBridge = { saveFile };
  return { bridge, saveFile };
}

describe('createDesktopFileSaver', () => {
  it('sends the filename and the blob bytes to the native save dialog', async () => {
    const { bridge, saveFile } = fakeBridge(true);
    await createDesktopFileSaver(bridge).save('週會紀錄.md', blobOf('# 週會紀錄\n'));

    expect(saveFile).toHaveBeenCalledTimes(1);
    const [filename, bytes] = saveFile.mock.calls[0];
    expect(filename).toBe('週會紀錄.md');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes)).toBe('# 週會紀錄\n');
  });

  it('rejects with AbortError when the user cancels the dialog', async () => {
    const { bridge } = fakeBridge(false);
    await expect(createDesktopFileSaver(bridge).save('a.txt', blobOf('a'))).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('passes other failures on to the caller', async () => {
    const { bridge } = fakeBridge(new Error('EACCES: permission denied'));
    await expect(createDesktopFileSaver(bridge).save('a.txt', blobOf('a'))).rejects.toThrow(
      'EACCES: permission denied',
    );
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/web -- src/platform/desktopFileSaver.test.ts`
Expected: FAIL，`Error: Failed to resolve import "./desktopFileSaver" from "src/platform/desktopFileSaver.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`apps/web/src/platform/desktopFileSaver.ts`：

```ts
import type { FileSaver } from '@oc/core';

/** The API apps/desktop/src/preload.ts exposes as `window.ocDesktop`. */
export interface OcDesktopBridge {
  /** Shows the native save dialog and writes the bytes; resolves false when the user cancels. */
  saveFile(filename: string, bytes: Uint8Array): Promise<boolean>;
}

/** Saves exports through Electron's native "Save as" dialog. */
export function createDesktopFileSaver(bridge: OcDesktopBridge): FileSaver {
  return {
    async save(filename, data) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      const saved = await bridge.saveFile(filename, bytes);
      // M2 convention: a cancelled dialog rejects with AbortError, and NoteActions stays quiet.
      if (!saved) throw new DOMException('使用者取消', 'AbortError');
    },
  };
}
```

`apps/web/src/global.d.ts`（契約的 `window.ocDesktop?: { saveFile(filename: string, bytes: Uint8Array): Promise<boolean> }`，以具名介面表達；檔案有 `import`，所以用 `declare global`）：

```ts
import type { OcDesktopBridge } from './platform/desktopFileSaver';

declare global {
  interface Window {
    /** Exposed by apps/desktop/src/preload.ts; undefined in browsers and in Capacitor. */
    ocDesktop?: OcDesktopBridge;
  }
}
```

`apps/web/tsconfig.json` 已包含 `src`，不需修改即可納入 `global.d.ts`。

- [ ] **Step 4: 執行測試與型別檢查，確認通過**

Run: `npm test -w @oc/web -- src/platform/desktopFileSaver.test.ts && npm run typecheck -w @oc/web`
Expected: `Tests  3 passed (3)`；`tsc --noEmit` 無錯誤輸出。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/platform/desktopFileSaver.ts apps/web/src/platform/desktopFileSaver.test.ts apps/web/src/global.d.ts
git commit -m "feat(web): add desktop FileSaver over window.ocDesktop"
```

---

### Task 6: `selectPlatform` 加入桌面分支

**Files:**
- Modify: `apps/web/src/platform/selectPlatform.ts`
- Modify: `apps/web/src/platform/selectPlatform.test.ts`

- [ ] **Step 1: 改寫測試（先失敗）**

整個檔案換成下列內容。第一個測試即 M1 原有的測試；新增「在 Electron 內走 `window.ocDesktop`」與「沒有 `window.ocDesktop` 時走瀏覽器下載」。瀏覽器分支沿用 M1 `browserFileSaver` 測試的假 `URL.createObjectURL` 與攔截 `<a>.click()`；假計時器只在開好資料庫之後才啟用（fake-indexeddb 依賴真實計時器）。

`apps/web/src/platform/selectPlatform.test.ts`：

```ts
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectPlatform } from './selectPlatform';

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

afterEach(() => {
  delete window.ocDesktop;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('selectPlatform', () => {
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

  it('saves through window.ocDesktop inside the Electron app', async () => {
    const saveFile = vi.fn(async (_filename: string, _bytes: Uint8Array) => true);
    window.ocDesktop = { saveFile };
    const platform = await selectPlatform();

    await platform.fileSaver.save('筆記.md', new NodeBlob(['# 筆記']) as unknown as Blob);

    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFile.mock.calls[0][0]).toBe('筆記.md');
    expect(new TextDecoder().decode(saveFile.mock.calls[0][1])).toBe('# 筆記');
    expect(platform.canPrint).toBe(true);
  });

  it('downloads through the browser when window.ocDesktop is absent', async () => {
    const platform = await selectPlatform();
    // jsdom has no object URLs and must not navigate; fake both (as in M1's browserFileSaver test).
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn((_blob: Blob) => 'blob:fake-url');
    URL.revokeObjectURL = vi.fn((_url: string) => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await platform.fileSaver.save('筆記.txt', new Blob(['內文']));

    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/web -- src/platform/selectPlatform.test.ts`
Expected: FAIL，`Tests  1 failed | 2 passed (3)`；失敗的是 `saves through window.ocDesktop inside the Electron app`，訊息 `TypeError: URL.createObjectURL is not a function`（M1 的實作仍用瀏覽器下載，而 jsdom 沒有 object URL）。

- [ ] **Step 3: 實作**

整個檔案換成：

`apps/web/src/platform/selectPlatform.ts`：

```ts
import {
  createBrowserFileSaver,
  createIndexedDbStorage,
  openAppDb,
  type FileSaver,
  type Platform,
} from '@oc/core';
import { createDesktopFileSaver } from './desktopFileSaver';

/** Web and Electron (M4). M5 adds Capacitor. */
export async function selectPlatform(): Promise<Platform> {
  const db = await openAppDb();
  return {
    storage: createIndexedDbStorage(db),
    fileSaver: selectFileSaver(),
    canPrint: true,
  };
}

function selectFileSaver(): FileSaver {
  // apps/desktop's preload script exposes window.ocDesktop; browsers do not have it.
  const desktop = window.ocDesktop;
  return desktop ? createDesktopFileSaver(desktop) : createBrowserFileSaver();
}
```

Electron 版仍是 `canPrint: true`：Electron 支援 `print()`（開 Windows 系統列印對話框，見 Verification 的手動檢查）。

- [ ] **Step 4: 執行測試、型別檢查與網頁建置，確認通過**

Run: `npm test -w @oc/web && npm run typecheck -w @oc/web`
Expected: `Test Files  2 passed (2)`、`Tests  6 passed (6)`；typecheck 無錯誤輸出。

Run: `npm run build -w @oc/web && grep -o 'src="/assets/[^"]*"' apps/web/dist/index.html`
Expected: `✓ built in`，沒有 `Some chunks are larger than 1000 kB` 警告；最後一行是 `src="/assets/index-<hash>.js"`。Vite `base` 維持 `/`，網頁正式部署完全不受影響；`/assets/...` 在 Electron 中解析為 `app://bundle/assets/...`（由 Task 7 的 e2e 驗證）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/platform/selectPlatform.ts apps/web/src/platform/selectPlatform.test.ts
git commit -m "feat(web): select desktop file saver inside Electron"
```

---

### Task 7: 主程序 `main.ts` 與 Electron 端對端測試

**Files:**
- Create: `apps/desktop/playwright.config.ts`
- Create: `apps/desktop/src/main.ts`
- Test: `apps/desktop/e2e/app.spec.ts`

- [ ] **Step 1: 建立 Playwright 設定**

`apps/desktop/playwright.config.ts`：

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Every test starts its own Electron app; run them one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
});
```

`_electron` 直接啟動 `node_modules` 裡的 Electron，不需要 `playwright install`。`test-results/` 已被根 `.gitignore` 忽略。

- [ ] **Step 2: 寫失敗的端對端測試**

每個測試用全新的使用者資料夾（`OC_USER_DATA_DIR`），IndexedDB 互不干擾；`--use-fake-device-for-media-stream` 提供假麥克風，但權限請求仍經過 `main.ts` 的處理器。原生「另存新檔」對話框無法自動操作，所以在主程序中把 `dialog.showSaveDialog` 換成記錄器（`main.ts` 在呼叫當下才讀 `dialog.showSaveDialog`，替換有效）；連結測試同樣把 `shell.openExternal` 換成記錄器，不會真的開瀏覽器。設定 `OC_E2E_EXECUTABLE` 時，同一份測試改跑安裝版（Task 8）。

另外三點：
- `electron.launch` 設 `timeout: 15_000`：App 起不來時 Electron 會跳出強制回應的錯誤對話框而不是結束，沒有逾時就要等到整個測試的 60 秒逾時。
- 「再啟動一次」測試的第二個程序會立刻結束，Playwright 無法附加到它，所以用 `child_process.spawn` 直接啟動同一個執行檔（開發版：在 Node 中 `require('electron')` 回傳 `electron.exe` 的路徑）並等它結束；15 秒還沒結束就殺掉並回報 `'still running'`，沒有單一實例鎖時測試會以此失敗。
- 「取消」測試先以 `MutationObserver` 記下狀態列出現過的每一段文字，再做一次成功的匯出當屏障：IPC 回覆依序送達，看到「已匯出 Markdown」時，renderer 一定已處理完先前取消的那一次，此時才檢查「沒寫檔、沒出現過其他訊息」。

`apps/desktop/e2e/app.spec.ts`：

```ts
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const DESKTOP_DIR = path.resolve(__dirname, '..');

/**
 * Starts apps/desktop (dist/main.js + apps/web/dist). With OC_E2E_EXECUTABLE set to the packaged
 * open-copilot.exe, the same tests run against the installed layout (resources/web) instead.
 */
function launch(userDataDir: string): Promise<ElectronApplication> {
  const env = { ...process.env, OC_USER_DATA_DIR: userDataDir } as Record<string, string>;
  // Chromium's fake microphone: getUserMedia works without hardware, and the permission request
  // still goes through main.ts's handler.
  const args = ['--use-fake-device-for-media-stream'];
  // Fail fast when the app cannot start: Electron then shows a modal error box instead of exiting.
  const timeout = 15_000;
  const executablePath = process.env.OC_E2E_EXECUTABLE;
  return executablePath
    ? electron.launch({ executablePath, args, env, timeout })
    : electron.launch({ args: [DESKTOP_DIR, ...args], env, timeout });
}

/**
 * Starts the app once more on the same profile, like a second double-click on the shortcut, and
 * resolves with its exit code ('still running' if it has not exited after 15 seconds).
 */
function launchAgain(userDataDir: string): Promise<number | null | 'still running'> {
  const env = { ...process.env, OC_USER_DATA_DIR: userDataDir };
  const executablePath = process.env.OC_E2E_EXECUTABLE;
  // In Node, the electron package exports the path of electron.exe.
  const [command, args]: [string, string[]] = executablePath
    ? [executablePath, []]
    : [require('electron') as string, [DESKTOP_DIR]];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill();
      resolve('still running');
    }, 15_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/** Titles the app has persisted in IndexedDB (database "open-copilot", store "notes"). */
function savedTitles(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('open-copilot');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('notes', 'readonly').objectStore('notes').getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve((request.result as { title: string }[]).map((note) => note.title));
          };
        };
      }),
  );
}

interface DialogRequest {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

/** Replaces dialog.showSaveDialog in the main process and records the options it receives. */
async function stubSaveDialog(app: ElectronApplication, result: { canceled: boolean; filePath: string }) {
  await app.evaluate(({ dialog }, stubResult) => {
    const requests: unknown[] = [];
    (globalThis as unknown as { ocSaveDialogRequests: unknown[] }).ocSaveDialogRequests = requests;
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      requests.push(args[args.length - 1]); // called as (options) or (window, options)
      return stubResult;
    }) as typeof dialog.showSaveDialog;
  }, result);
}

function saveDialogRequests(app: ElectronApplication): Promise<DialogRequest[]> {
  return app.evaluate(
    () => (globalThis as unknown as { ocSaveDialogRequests: DialogRequest[] }).ocSaveDialogRequests,
  );
}

/** Title 週會紀錄 and one body paragraph 第一點. */
async function writeNote(page: Page) {
  await page.getByRole('textbox', { name: '標題' }).fill('週會紀錄');
  await page.getByRole('textbox', { name: '筆記內文' }).click();
  await page.keyboard.type('第一點');
}

let userDataDir: string;
let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  userDataDir = mkdtempSync(path.join(tmpdir(), 'oc-desktop-e2e-'));
  app = await launch(userDataDir);
  page = await app.firstWindow();
  await expect(page.getByRole('textbox', { name: '標題' })).toBeVisible();
});

test.afterEach(async () => {
  await app?.close(); // undefined when the launch itself failed
  rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('開啟視窗並從 app://bundle 載入網頁版', async () => {
  expect(page.url()).toBe('app://bundle/index.html');
  await expect(page).toHaveTitle('open-copilot');
  await expect(page.getByRole('textbox', { name: '標題' })).toHaveAttribute('placeholder', '請輸入標題..');

  // The page sees only the preload bridge, never Node.
  const exposed = await page.evaluate(() => ({
    bridge: Object.keys((window as unknown as { ocDesktop?: object }).ocDesktop ?? {}),
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
  }));
  expect(exposed).toEqual({ bridge: ['saveFile'], require: 'undefined', process: 'undefined' });

  const appInfo = await app.evaluate(({ app: electronApp, BrowserWindow }) => ({
    // productName: user data lives in %APPDATA%\open-copilot.
    name: electronApp.getName(),
    // Recording must keep its timers running while the window is minimized.
    backgroundThrottling: BrowserWindow.getAllWindows()[0].webContents.getBackgroundThrottling(),
  }));
  expect(appInfo).toEqual({ name: 'open-copilot', backgroundThrottling: false });
});

test('輸入標題後重新載入、重新啟動，標題仍在', async () => {
  const title = page.getByRole('textbox', { name: '標題' });
  await title.fill('桌面版筆記');
  // Wait for the 500ms debounced save to reach IndexedDB.
  await expect.poll(() => savedTitles(page)).toEqual(['桌面版筆記']);

  await page.reload();
  await expect(title).toHaveValue('桌面版筆記');

  await app.close();
  app = await launch(userDataDir);
  page = await app.firstWindow();
  await expect(page.getByRole('textbox', { name: '標題' })).toHaveValue('桌面版筆記');
});

test('輸入後立刻關閉 App，重新啟動後最後的輸入仍在', async () => {
  await page.getByRole('textbox', { name: '標題' }).fill('立刻關閉');
  // No wait for the 500ms debounce: M1's pagehide flush (with tx.commit) must survive app.quit().
  await app.close();

  app = await launch(userDataDir);
  page = await app.firstWindow();
  await expect(page.getByRole('textbox', { name: '標題' })).toHaveValue('立刻關閉');
});

test('再啟動一次：不開第二個 App，既有視窗被帶到前面', async () => {
  await app.evaluate(({ app: electronApp }) => {
    const seen = { secondInstances: 0 };
    (globalThis as unknown as { ocSingleInstance: typeof seen }).ocSingleInstance = seen;
    electronApp.on('second-instance', () => {
      seen.secondInstances += 1;
    });
  });

  // The second process hands over to this one and quits by itself.
  expect(await launchAgain(userDataDir)).toBe(0);

  await expect
    .poll(() =>
      app.evaluate(
        () => (globalThis as unknown as { ocSingleInstance: { secondInstances: number } }).ocSingleInstance.secondInstances,
      ),
    )
    .toBe(1);
  expect(app.windows()).toHaveLength(1);
  // The first app still owns the database and keeps saving.
  await page.getByRole('textbox', { name: '標題' }).fill('仍可編輯');
  await expect.poll(() => savedTitles(page)).toEqual(['仍可編輯']);
});

test('匯出 Markdown 經原生「另存新檔」對話框寫入檔案', async () => {
  const target = path.join(userDataDir, '匯出結果.md');
  await stubSaveDialog(app, { canceled: false, filePath: target });
  await writeNote(page);

  await page.getByRole('button', { name: '匯出' }).click();
  await page.getByRole('menuitem', { name: 'Markdown' }).click();

  await expect(page.getByRole('status')).toHaveText('已匯出 Markdown');
  expect(readFileSync(target, 'utf8')).toBe('# 週會紀錄\n\n第一點\n');
  const [request] = await saveDialogRequests(app);
  expect(path.basename(request.defaultPath ?? '')).toBe('週會紀錄.md');
  expect(request.filters?.[0]).toEqual({ name: 'Markdown', extensions: ['md'] });
});

test('匯出 Word：從 app://bundle 載入 docx 分塊並寫入 .docx', async () => {
  const target = path.join(userDataDir, '匯出結果.docx');
  await stubSaveDialog(app, { canceled: false, filePath: target });
  await writeNote(page);

  await page.getByRole('button', { name: '匯出' }).click();
  await page.getByRole('menuitem', { name: 'Word' }).click();

  await expect(page.getByRole('status')).toHaveText('已匯出 Word');
  expect(readFileSync(target).subarray(0, 2).toString('latin1')).toBe('PK'); // a .docx is a zip file
  const [request] = await saveDialogRequests(app);
  expect(path.basename(request.defaultPath ?? '')).toBe('週會紀錄.docx');
  expect(request.filters?.[0]).toEqual({ name: 'Word 文件', extensions: ['docx'] });
});

test('在「另存新檔」按取消：不寫檔、不顯示訊息', async () => {
  // Record every message the status line shows, however briefly.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { ocStatusTexts: string[] }).ocStatusTexts = seen;
    const status = document.querySelector('.oc-action-status')!;
    new MutationObserver(() => {
      if (status.textContent) seen.push(status.textContent);
    }).observe(status, { childList: true, characterData: true, subtree: true });
  });

  const target = path.join(userDataDir, '不該存在.txt');
  // Even with a path in the result, a cancelled dialog must not write anything.
  await stubSaveDialog(app, { canceled: true, filePath: target });
  await page.getByRole('button', { name: '匯出' }).click();
  await page.getByRole('menuitem', { name: '純文字' }).click();
  await expect.poll(async () => (await saveDialogRequests(app)).length).toBe(1);

  // A successful export afterwards is the barrier: IPC replies arrive in order, so once its
  // message shows, the renderer has finished handling the cancelled one.
  const second = path.join(userDataDir, '第二次.md');
  await stubSaveDialog(app, { canceled: false, filePath: second });
  await page.getByRole('button', { name: '匯出' }).click();
  await page.getByRole('menuitem', { name: 'Markdown' }).click();
  await expect(page.getByRole('status')).toHaveText('已匯出 Markdown');

  expect(existsSync(second)).toBe(true);
  expect(existsSync(target)).toBe(false);
  // Neither 已匯出純文字 nor 匯出失敗，請再試一次 ever appeared for the cancelled export.
  expect(await page.evaluate(() => (window as unknown as { ocStatusTexts: string[] }).ocStatusTexts)).toEqual([
    '已匯出 Markdown',
  ]);
});

test('複製全文寫入系統剪貼簿', async () => {
  await writeNote(page);
  await page.getByRole('button', { name: '複製', exact: true }).click();

  await expect(page.getByRole('status')).toHaveText('已複製全文');
  // Read it back in the main process; the page itself may not read the clipboard.
  const text = await app.evaluate(async ({ clipboard }) => await clipboard.readText());
  expect(text.replaceAll('\r\n', '\n')).toBe('週會紀錄\n\n第一點');
});

test('筆記中的連結交給系統瀏覽器開啟，App 視窗不跳轉', async () => {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as unknown as { ocOpenedUrls: string[] }).ocOpenedUrls = opened;
    shell.openExternal = (async (url: string) => {
      opened.push(url);
    }) as typeof shell.openExternal;
  });
  await page.getByRole('textbox', { name: '筆記內文' }).click();
  // The space after the URL lets Tiptap's autolink turn it into a link.
  await page.keyboard.type('參考 https://example.com/docs 網站');
  await page.getByRole('link', { name: 'https://example.com/docs' }).click();

  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { ocOpenedUrls: string[] }).ocOpenedUrls))
    .toEqual(['https://example.com/docs']);
  expect(app.windows()).toHaveLength(1);
  expect(page.url()).toBe('app://bundle/index.html');
});

test('允許麥克風、拒絕相機', async () => {
  const audioTracks = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const count = stream.getAudioTracks().length;
    stream.getTracks().forEach((track) => track.stop());
    return count;
  });
  expect(audioTracks).toBe(1);

  const camera = await page.evaluate(() =>
    navigator.mediaDevices.getUserMedia({ video: true }).then(
      () => 'granted',
      (error: Error) => error.name,
    ),
  );
  expect(camera).toBe('NotAllowedError');
});
```

說明：`clipboard.readText()` 在 Electron 45 的主程序回傳 `Promise<string>`（較舊版本回傳 `string`），`await` 兩者皆可。Markdown 與純文字的預期內容與 M2 的網頁 e2e 一致（Windows 剪貼簿換行為 `\r\n`，比對前換回 `\n`）。PDF 列印不在 e2e 內：Electron 的 `print()` 開的是會阻塞 renderer 的系統對話框。

- [ ] **Step 3: 執行，確認失敗**

Run: `npm run e2e -w @oc/desktop -- --max-failures=1`
Expected: 先完成網頁版 `vite build` 與桌面 `tsc` 建置，接著約 15 秒後 Playwright FAIL：

```
  x  1 e2e\app.spec.ts:… › 開啟視窗並從 app://bundle 載入網頁版 (15.…s)
Testing stopped early after 1 maximum allowed failures.
…
    TimeoutError: electron.launch: Timeout 15000ms exceeded.
…
  1 failed
  9 did not run
  1 error was not a part of any test, see above for details
```

原因：`dist/main.js` 還不存在，Electron 內建的預設 App 找不到 App，跳出「Error launching app — Unable to find Electron app at …」的強制回應錯誤對話框並停在那裡，不會輸出 `DevTools listening on`，所以 `electron.launch` 在 15 秒後逾時。最後一行是 `--max-failures` 提前停止的提示，不是另一個錯誤。等待期間不要操作；若測試結束後錯誤對話框仍留在畫面上，按「確定」關閉它。

- [ ] **Step 4: 實作主程序**

`apps/desktop/src/main.ts`：

```ts
import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_ENTRY_URL, APP_SCHEME, isAppUrl, resolveAppPath } from './appProtocol';
import { createSaveFileHandler, SAVE_FILE_CHANNEL } from './saveFile';
import { isExternalHttpUrl, shouldGrantPermission } from './security';

// Must run before the app is ready. `standard` + `secure` give app://bundle a real origin and a
// secure context (IndexedDB, crypto.randomUUID, getUserMedia, clipboard all need one).
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

// The e2e tests give every run its own empty profile (IndexedDB, localStorage). A development
// build (`npm run dev`) gets a profile of its own, so it never opens or locks the installed app's notes.
if (process.env.OC_USER_DATA_DIR) {
  app.setPath('userData', process.env.OC_USER_DATA_DIR);
} else if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'open-copilot-dev'));
}

/** The web build: apps/web/dist during development, resources/web in the installed app. */
function webRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.join(__dirname, '..', '..', 'web', 'dist');
}

function registerAppProtocol(rootDir: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const filePath = resolveAppPath(request.url, rootDir);
    if (!filePath) return new Response('Not found', { status: 404 });
    try {
      return await net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function registerPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(shouldGrantPermission(permission, details));
  });
}

function registerSaveFile(): void {
  ipcMain.handle(SAVE_FILE_CHANNEL, (event, filename: unknown, bytes: unknown) => {
    if (!isAppUrl(event.senderFrame?.url ?? '')) {
      throw new Error('oc:save-file is only available to app://bundle pages');
    }
    const owner = BrowserWindow.fromWebContents(event.sender);
    const saveFile = createSaveFileHandler({
      showSaveDialog: (options) =>
        owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options),
      writeFile: (filePath, data) => fs.writeFile(filePath, data),
      defaultDir: () => app.getPath('documents'),
    });
    return saveFile(filename, bytes);
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 360,
    minHeight: 480,
    title: 'open-copilot',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep cutting and uploading segments on time while the window is minimized.
      backgroundThrottling: false,
    },
  });

  // Links in a note open in the system browser; the app window itself never leaves app://bundle.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => {
    if (isAppUrl(event.url)) return;
    event.preventDefault();
    if (isExternalHttpUrl(event.url)) void shell.openExternal(event.url);
  });

  void win.loadURL(APP_ENTRY_URL);
  return win;
}

// One app per profile: a second process would find IndexedDB locked (blank window) or, worse,
// overwrite the first one's notes. The lock is keyed on the userData folder set above.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  void app.whenReady().then(() => {
    registerAppProtocol(webRoot());
    registerPermissions();
    registerSaveFile();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

說明：
- `protocol.handle` + `net.fetch(file://…)` 是 Electron 文件建議的寫法，回應的 `Content-Type` 由副檔名決定，`<script type="module">` 能正常載入。
- `setPermissionRequestHandler` 的 `details` 直接傳給 `shouldGrantPermission`：Electron 的 `PermissionRequest`／`MediaAccessPermissionRequest` 都可指派給 `PermissionDetails`（只讀 `requestingUrl`、`mediaTypes`），不需要轉型。
- `dialog.showSaveDialog` 有「帶視窗」與「不帶視窗」兩個多載，所以依 `owner` 是否存在分開呼叫；帶視窗時對話框是 App 視窗的強制回應視窗。
- `event.url`（`will-navigate`）與可能為 `null` 的 `event.senderFrame` 是 Electron 新版的型別；以 `?.` 存取兩種版本都能編譯。
- 使用者資料夾要在 `requestSingleInstanceLock()` 之前決定：鎖以 userData 資料夾為單位，順序反過來時 e2e 的暫存資料夾會共用同一把鎖。`app.getPath('appData')` 與 `app.setPath('userData', …)` 都可在 ready 之前呼叫。
- 拿不到鎖時在 ready 之前呼叫 `app.quit()`：Electron 等主訊息迴圈可用後就結束（exit code 0），不會建立視窗、也不會開 IndexedDB；`window-all-closed` 的註冊放在 `if` 之外，兩種情況都無害。
- 關閉視窗時沒有另外處理「先存檔再關」：M1 的 `useNotes` 在 `pagehide` 時 flush，`createIndexedDbStorage().put` 會明確 `tx.commit()`，`app.quit()` 關閉視窗時這筆寫入照常完成（e2e「輸入後立刻關閉 App」驗證；拿掉 `pagehide` flush 時該測試會失敗）。

- [ ] **Step 5: 執行端對端測試，確認通過**

Run: `npm run e2e -w @oc/desktop`
Expected:

```
Running 10 tests using 1 worker

  ok  1 e2e\app.spec.ts:… › 開啟視窗並從 app://bundle 載入網頁版
  ok  2 e2e\app.spec.ts:… › 輸入標題後重新載入、重新啟動，標題仍在
  ok  3 e2e\app.spec.ts:… › 輸入後立刻關閉 App，重新啟動後最後的輸入仍在
  ok  4 e2e\app.spec.ts:… › 再啟動一次：不開第二個 App，既有視窗被帶到前面
  ok  5 e2e\app.spec.ts:… › 匯出 Markdown 經原生「另存新檔」對話框寫入檔案
  ok  6 e2e\app.spec.ts:… › 匯出 Word：從 app://bundle 載入 docx 分塊並寫入 .docx
  ok  7 e2e\app.spec.ts:… › 在「另存新檔」按取消：不寫檔、不顯示訊息
  ok  8 e2e\app.spec.ts:… › 複製全文寫入系統剪貼簿
  ok  9 e2e\app.spec.ts:… › 筆記中的連結交給系統瀏覽器開啟，App 視窗不跳轉
  ok 10 e2e\app.spec.ts:… › 允許麥克風、拒絕相機

  10 passed
```

整批約 12 秒（不含建置）。第 4 個測試執行時 App 視窗會被帶到前景，屬正常。若只有第 8 個（複製）失敗且 `Received: ""`，先在 PowerShell 執行 `Set-Clipboard -Value probe; Get-Clipboard`：若也印不出 `probe`，是這台機器的系統剪貼簿暫時無法使用（例如被其他程式占用），排除後重跑，不要修改程式。

- [ ] **Step 6: 重複執行確認穩定，並做型別檢查**

Run: `npm exec -w @oc/desktop -- playwright test --repeat-each=3 && npm run typecheck -w @oc/desktop`
Expected: `30 passed`；typecheck 無錯誤輸出。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/playwright.config.ts apps/desktop/src/main.ts apps/desktop/e2e/app.spec.ts
git commit -m "feat(desktop): add main process and Electron e2e tests"
```

---

### Task 8: electron-builder 打包 Windows 安裝檔

**Files:**
- Create: `apps/desktop/electron-builder.yml`
- Modify: `.gitignore`

- [ ] **Step 1: 忽略打包輸出**

整個檔案換成（M1 的內容 + 最後一行）：

`.gitignore`：

```gitignore
node_modules/
dist/
coverage/
playwright-report/
test-results/
.env
apps/web/android/app/build/
apps/desktop/release/
```

- [ ] **Step 2: 建立 electron-builder 設定**

`apps/desktop/electron-builder.yml`：

```yaml
appId: com.opencopilot.desktop
directories:
  output: release
files:
  - dist/**/*
  - package.json
extraResources:
  - from: ../web/dist
    to: web
win:
  target:
    - target: nsis
      arch:
        - x64
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  artifactName: open-copilot-setup-${version}.${ext}
publish: null
```

說明：產品名稱取自 `package.json` 的 `productName`（`open-copilot.exe`、開始功能表名稱）；`files` 只打包 `tsc` 輸出與 `package.json`（App 沒有執行期依賴）；`extraResources` 把網頁 build 放到 `resources/web`，對應 `main.ts` 的 `process.resourcesPath/web`；`publish: null` 避免 electron-builder 26.15.3 在沒有 repository 時產生更新資訊而崩潰。

- [ ] **Step 3: 對尚未存在的安裝版跑 e2e，確認失敗**

Run: `OC_E2E_EXECUTABLE="$(pwd -W)/apps/desktop/release/win-unpacked/open-copilot.exe" npm exec -w @oc/desktop -- playwright test --max-failures=1`
Expected: 不到 1 秒就 FAIL，`Error: Process failed to launch!`，`1 failed`、`9 did not run`，最後一行 `1 error was not a part of any test, see above for details`（`--max-failures` 提前停止的提示）。原因是還沒有打包：Playwright 在 Windows 上經由 `cmd.exe`（`shell: true`）啟動 Electron，執行檔不存在時是 `cmd.exe` 回報找不到指令後結束，所以訊息是 `Process failed to launch!`，不是 `spawn … ENOENT`。`pwd -W` 輸出 `D:/git/open-copilot` 這種 Windows 路徑，讓 Node 能找到執行檔。

- [ ] **Step 4: 產出安裝檔**

Run: `npm run dist -w @oc/desktop`
Expected: 先 `vite build` 與 `tsc`，接著 electron-builder 輸出（第一次會多出 `downloaded … electron`／`nsis`／`7zip` 等下載訊息）：

```
  • electron-builder  version=26.15.3 os=10.0.26200
  • loaded configuration  file=…\apps\desktop\electron-builder.yml
  …
  • packaging       platform=win32 arch=x64 electron=45.0.0 appOutDir=release\win-unpacked
  …
  • default Electron icon is used  reason=application icon is not set
  • building        target=nsis file=release\open-copilot-setup-0.1.0.exe archs=x64 oneClick=false perMachine=false
  • building block map  blockMapFile=release\open-copilot-setup-0.1.0.exe.blockmap
```

沒有任何 `⨯` 開頭的錯誤行。

Run: `ls apps/desktop/release apps/desktop/release/win-unpacked/resources apps/desktop/release/win-unpacked/resources/web/assets`
Expected: `release` 內有 `open-copilot-setup-0.1.0.exe`（約 107 MB）、`open-copilot-setup-0.1.0.exe.blockmap`、`win-unpacked`；`resources` 內有 `app.asar`、`web`；`web/assets` 內有 `index-*.js`、`index-*.css`、`toDocx-*.js`、`common-*.js`。

- [ ] **Step 5: 對安裝版跑 e2e，確認通過**

Run: `OC_E2E_EXECUTABLE="$(pwd -W)/apps/desktop/release/win-unpacked/open-copilot.exe" npm exec -w @oc/desktop -- playwright test`
Expected: `10 passed`（`app.isPackaged` 為 true，網頁從 `resources/web` 載入；「再啟動一次」測試直接執行 `open-copilot.exe`，驗證安裝版同樣只會有一個實例）。

- [ ] **Step 6: 確認打包輸出沒有進版控**

Run: `git status --short -- . ':(exclude)docs/superpowers/plans'`
Expected: 只有 ` M .gitignore` 與 `?? apps/desktop/electron-builder.yml`；沒有 `apps/desktop/release/`、`apps/desktop/dist/`、`apps/desktop/test-results/`（計畫檔因勾選 checkbox 而變動是允許的，故排除）。

- [ ] **Step 7: Commit**

```bash
git add .gitignore apps/desktop/electron-builder.yml
git commit -m "chore(desktop): package Windows installer with electron-builder"
```

---

### Task 9: Verification（整體驗證）

**Files:** 無新增或修改。

- [ ] **Step 1: 全部單元與元件測試**

Run: `npm test`
Expected:
- `@oc/core`：`Test Files  46 passed (46)`、`Tests  296 passed (296)`（本計畫未修改，以 M3b 計畫為準）
- `@oc/shared`：`Test Files  1 passed (1)`、`Tests  3 passed (3)`
- `@oc/api`（M3a）：`Test Files  9 passed (9)`、`Tests  49 passed (49)`（本計畫未修改，以 M3a 計畫為準）
- `@oc/desktop`：`Test Files  4 passed (4)`、`Tests  26 passed (26)`
- `@oc/web`：`Test Files  2 passed (2)`、`Tests  6 passed (6)`

任何工作區都不應出現 `failed`；`@oc/desktop`、`@oc/web` 的輸出中不應出現 `stderr` 或 `Unhandled Errors`。

- [ ] **Step 2: 全部型別檢查**

Run: `npm run typecheck`
Expected: 每個 workspace 的 `tsc --noEmit` 皆無錯誤輸出（含 `@oc/desktop`）。

- [ ] **Step 3: 網頁版端對端測試（確認網頁部署不受影響）**

Run: `npm run e2e -w @oc/web -- --repeat-each=3`
Expected: `33 passed`（與 M3b 相同）。

Run: `npm run build -w @oc/web`
Expected: `✓ built in`；`dist/assets/index-*.js` 約 686 kB、`toDocx-*.js` 約 365 kB；沒有 `Some chunks are larger than 1000 kB` 警告；`dist/index.html` 引用 `/assets/…`（`base` 未改）。

- [ ] **Step 4: 桌面版端對端測試（開發版，重複 3 次）**

Run: `npm run e2e -w @oc/desktop -- --repeat-each=3`
Expected: `30 passed`。

- [ ] **Step 5: 安裝檔與安裝版端對端測試**

Run: `npm run dist -w @oc/desktop`
Expected: 產生 `apps/desktop/release/open-copilot-setup-0.1.0.exe`，沒有 `⨯` 錯誤行。

Run: `OC_E2E_EXECUTABLE="$(pwd -W)/apps/desktop/release/win-unpacked/open-copilot.exe" npm exec -w @oc/desktop -- playwright test`
Expected: `10 passed`。

- [ ] **Step 6: 手動檢查表（Windows 實機）**

準備 M3a 後端：`apps/api/.env` 填入真的 `OPENAI_API_KEY`、`ACCESS_KEYS=dev-key`，`ALLOWED_ORIGINS` 保留範例值（已含 `app://bundle`）。開一個 Git Bash：

Run: `(unset OPENAI_API_KEY ACCESS_KEYS ALLOWED_ORIGINS PORT; npm run dev -w @oc/api)`
Expected: 伺服器在 `http://localhost:8787` 啟動。

安裝與啟動：
- [ ] 執行 `apps/desktop/release/open-copilot-setup-0.1.0.exe`。安裝檔未簽章，若出現「Windows 已保護您的電腦」，按「其他資訊」→「仍要執行」。安裝精靈可選擇安裝位置；完成後開始功能表有「open-copilot」。
- [ ] 啟動後視窗標題為「open-copilot」（Electron 預設圖示）；自動有一篇空白筆記，標題框顯示「請輸入標題..」，內文顯示「在這裡開始編寫筆記..」；畫面與網頁版一致，沒有選單列（按 Alt 才出現）。

設定與錄音（1 分鐘）：
- [ ] 按齒輪，後端網址填 `http://localhost:8787`、存取金鑰填 `dev-key`，按「測試連線」顯示「連線成功」，按「儲存」後錄製鈕變成「錄製」。
- [ ] 在內文中間點一下，按「錄製」：不會跳出任何權限詢問（桌面版由主程序授權），按鈕變成紅色「停止」，左側筆記清單無法操作。
- [ ] 用中文連續說話 **1 分鐘**（自然停頓）：每 4–8 秒在游標處插入一段繁體中文，順序與說話順序一致。途中把視窗最小化約 20 秒再還原：最小化期間說的話也照常分段插入（沒有變成一大段或延遲到還原後才出現）。
- [ ] 按「停止」：短暫顯示「處理中」，最後一段插入後回到「錄製」。按 Ctrl+Shift+I 開 DevTools → Network：每段 `/transcribe` 的 Request Headers 有 `Origin: app://bundle`，回應 200；Payload 中的音訊為 `segment-N.webm`（`audio/webm`），大小遠小於 5 MB。
- [ ] Windows 設定 → 隱私權與安全性 → 麥克風 → 關閉「讓桌面應用程式存取您的麥克風」，回到 App 按「錄製」：顯示「無法使用麥克風，請在系統或瀏覽器設定中允許麥克風權限」，沒有開始錄音。改回開啟後再按「錄製」可正常錄音。
- [ ] 錄音中拔掉 USB 麥克風（或在 Windows 音效設定停用輸入裝置）：顯示「錄音已中斷，已錄的部分會照常轉寫」，已錄部分照常插入。

匯出（原生「另存新檔」對話框，每種格式各一次）：
- [ ] 建立標題「週會紀錄」的筆記，內文含標題 1、粗體、紅字、黃色螢光、項目清單。
- [ ] 匯出 → Markdown：出現 Windows「另存新檔」對話框（App 視窗為其擁有者），預設位置為「文件」、檔名「週會紀錄.md」，存檔類型為「Markdown (*.md)」，下拉另有「所有檔案 (*.*)」。儲存後狀態列顯示「已匯出 Markdown」，以 VS Code 開啟內容正確。
- [ ] 匯出 → Word：檔名「週會紀錄.docx」、類型「Word 文件 (*.docx)」；以 Word 開啟，標題、粗體、紅字、黃色底色、清單皆保留；狀態列顯示「已匯出 Word」。
- [ ] 匯出 → 純文字：檔名「週會紀錄.txt」、類型「純文字 (*.txt)」；以記事本開啟中文無亂碼；狀態列顯示「已匯出純文字」。
- [ ] 任一格式在對話框按「取消」：不產生檔案，狀態列不顯示任何訊息。
- [ ] 存檔時覆蓋一個已存在的同名檔案：Windows 先詢問是否取代，確認後內容為新匯出的版本。

PDF（系統列印對話框）：
- [ ] 匯出 → PDF：出現 Windows 列印對話框（Electron 沒有 Chrome 的預覽畫面）；對話框開著時視窗標題顯示「週會紀錄」。印表機選「Microsoft Print to PDF」→「列印」→ 選擇存檔位置與檔名後儲存。開啟 PDF：標題與內文一致，紅字與黃色螢光底色保留。
- [ ] 關閉列印對話框（列印完成或按「取消」）後：視窗標題回到「open-copilot」，App 可正常操作；DevTools Console 執行 `document.querySelectorAll('iframe[data-oc-print]').length` 得到 `0`。若標題沒有換回或結果不是 `0`，代表 Electron 沒有觸發 `afterprint`，記錄後回報（M2 的 `printPdf` 會在下次列印前自行清理，不影響功能）。

其他：
- [ ] 按「複製」：狀態列顯示「已複製全文」；貼到 Word 保留標題與粗體等格式，貼到記事本為純文字（標題、空行、內文）。
- [ ] 在內文輸入 `https://example.com `（結尾有空格）變成連結後點擊：以系統預設瀏覽器開啟，App 視窗不跳轉、不多開視窗。
- [ ] 關閉 App 再從開始功能表開啟：筆記與設定都還在（資料位於 `%APPDATA%\open-copilot`）。
- [ ] 在標題輸入幾個字後**立刻**按 Alt+F4（不要等待），再從開始功能表開啟：剛輸入的字還在。
- [ ] App 開著時（可先最小化），從開始功能表再開一次 open-copilot：不會開第二個視窗、也不會出現空白視窗，既有視窗被還原並帶到前景；工作管理員中只有一組 open-copilot。
- [ ] 開發模式（安裝版保持開著）：`npm run dev -w @oc/desktop` 另外開出一個 App 視窗（讀取 `apps/web/dist`），裡面是一篇新的空白筆記，看不到安裝版的筆記（開發版資料在 `%APPDATA%\open-copilot-dev`）；兩個視窗都能正常編輯。關閉開發版視窗後指令結束，安裝版不受影響。
- [ ] Windows 設定 → 應用程式 → 已安裝的應用程式 → open-copilot → 解除安裝：可正常解除安裝。

- [ ] **Step 7: 確認工作目錄乾淨**

Run: `git status --short -- . ':(exclude)docs/superpowers/plans'`
Expected: 沒有輸出（`apps/desktop/release/`、`apps/desktop/dist/`、`test-results/`、`apps/api/.env` 皆被 `.gitignore` 忽略；計畫檔因勾選 checkbox 而變動是允許的，故排除）。
