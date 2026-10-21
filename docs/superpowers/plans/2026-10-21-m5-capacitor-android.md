# M5 Capacitor Android App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把網頁版包成 Android App（Capacitor 8）：同一份 `apps/web` build、筆記照樣存在 WebView 的 IndexedDB、麥克風錄音可用且切到背景時正確中斷並提示、匯出改走 Android 系統分享選單、隱藏「匯出 PDF」，並在實機上完成手動檢查。

**Architecture:** `apps/web` 同時是 Capacitor 專案：`capacitor.config.ts` 指向 `dist`，`cap add android` 產生的 `apps/web/android` 進版控，只多宣告麥克風權限。平台差異全部留在 `apps/web/src/platform/`：`selectPlatform()` 以 `Capacitor.isNativePlatform()` 改用 `createCapacitorFileSaver`（寫入 App 快取 → `Share.share`）並設 `canPrint: false`，同時安裝 `installBackgroundMicGuard`，在 App 暫停／隱藏時明確結束麥克風 track，讓 M3b 既有的中斷流程接手；`packages/core` 一行都不改。另外 `index.html` 拿掉 `viewport-fit=cover`（讓 Capacitor 8 把畫面放在系統列之間），Vite dev server 不再掃描、監看 `android/`。

**Tech Stack:** Capacitor 8（`@capacitor/core`／`cli`／`android` 8.5、`@capacitor/filesystem` 8.1、`@capacitor/share` 8.0）、範本內建的 Android Gradle Plugin 8.13 + Gradle 8.14.3、JDK 21、Android SDK 36、TypeScript 5.9、Vite 7、Vitest 3 + jsdom 26、Playwright 1.64（Pixel 7 模擬）。

---

## 前置條件

- 在 repo 根目錄 `D:\git\open-copilot` 以 **Git Bash** 執行所有指令（Task 1 的安裝步驟另用 PowerShell）。Windows 11、Node 24、npm 11。
- M1（`2026-10-21-m1-web-editor.md`）、M2、M3a、M3b、M4（`2026-10-21-m4-electron-desktop.md`）已全部完成並 commit。本計畫的「修改」步驟以這些計畫產出的檔案為準：
  - `apps/web/package.json`、`apps/web/tsconfig.json`、`apps/web/vite.config.ts`、`apps/web/index.html`：M1 Task 20 的內容（之後的計畫都沒改過）。
  - `apps/web/src/platform/selectPlatform.ts`／`selectPlatform.test.ts`：M4 Task 6 的內容。
  - 根目錄 `.gitignore`：M4 Task 8 的內容。
- 需要網路：npm 套件；第一次 Gradle 建置會下載 Gradle 8.14.3 與 Android 相依套件（數百 MB）。
- 需要一支 Android 手機（Android 7.0／API 24 以上，建議 Android 12 以上）與 USB 傳輸線。spec §9 規定 Android 以**實機**手動檢查。
- 實機檢查需要一個以 **https** 提供的 M3a 後端（見「與共用契約的關係」的「後端連線」）。
- 本計畫的驗證程度：撰寫時在這台機器的暫存目錄重建了 M4 結束時的 `apps/web`（`selectPlatform`、`desktopFileSaver`、`global.d.ts`、設定檔）與 `@oc/core` 的平台模組（`openAppDb`、`createIndexedDbStorage`、`createBrowserFileSaver`），以實際版本（@capacitor/* 8.5.3／8.1.5／8.0.3、vitest 3.2.7、jsdom 26.1.0、typescript 5.9.3、vite 7.3.7、@playwright/test 1.64.1）跑過：套件安裝、`cap add android`／`cap sync android`（不需要 Java）、Task 2–8 每個測試的「先失敗、後通過」與失敗訊息、亂序執行（`--sequence.shuffle`）、`tsc --noEmit`、`vite build`、以 `DEBUG=vite:deps` 確認 Task 4 前後 Vite 掃描的入口；Task 9 的 Playwright 測試以模擬頁面確認過操作方式（`tap`、Pixel 7 設定）。**沒有實跑**的部分：Gradle 建置、安裝到手機與所有實機行為（這台機器沒有 JDK 與 Android SDK），以及以完整 M1–M3b 介面跑 Task 9 的 e2e。執行時若數字或訊息不符，以實際輸出為準並回報。

- [ ] **前置步驟 1：確認 M1–M4 已完成**

Run: `npm test -w @oc/web`
Expected: `Test Files  2 passed (2)`、`Tests  6 passed (6)`（M4 結束時的數字）。

Run: `ls apps/web/src/platform/desktopFileSaver.ts apps/web/src/global.d.ts apps/desktop/src/main.ts packages/core/src/recording/useRecorder.ts`
Expected: 四個檔案都列出，沒有 `No such file or directory`。

- [ ] **前置步驟 2：commit 計畫文件**

Run: `git status --short`
Expected: 沒有輸出，或只有 `docs/superpowers/plans/` 底下的變動（例如本計畫檔 `?? docs/superpowers/plans/2026-10-21-m5-capacitor-android.md`，或勾選 checkbox 造成的修改）。若出現其他路徑，先停下來回報。

若有 `docs/superpowers/plans/` 的變動：

```bash
git add docs/superpowers/plans
git commit -m "docs: add M5 Capacitor Android plan"
```

Run: `git status --short`
Expected: 沒有輸出。

## 與共用契約的關係（下游計畫必讀）

本計畫遵守 `2026-10-21-00-overview.md` 的「手機」套件、`selectPlatform` 的 `Capacitor.isNativePlatform()` 分支（`canPrint: false`）與 `platform/capacitorFileSaver.ts`。下表是契約沒有寫死、由本計畫決定（或因實測而必須偏離）的細節：

| 項目 | 決定 |
|---|---|
| Capacitor 版本 | 契約寫 `@latest`（同主版本）。撰寫時的 latest：`@capacitor/core`／`cli`／`android` **8.5.3**、`@capacitor/filesystem` **8.1.5**、`@capacitor/share` **8.0.3**（9.0 仍是 alpha）。本計畫的程式、指令與預期輸出都依 8.x，所以寫成 `^8.5.3`／`^8.1.5`／`^8.0.3`：執行時若有更新的 8.x 照裝，不會跨到 9。 |
| Android 專案 | `apps/web/android`（Capacitor 預設目錄），整個 Gradle 專案進版控（53 個檔案）。範本自帶的 `android/.gitignore` 排除 build、`.gradle`、`local.properties`、複製進去的網頁（`app/src/main/assets/public`）、`capacitor.config.json`、`capacitor.plugins.json` 與 `capacitor-cordova-android-plugins`；根 `.gitignore` 另外排除 Android Studio 的 `apps/web/android/.idea/`。因為後幾項不進版控，新 clone 要先 `npm run cap:sync -w @oc/web` 才能用 Android Studio 開啟（`android:run` 會自動同步）。 |
| 範本內容 | Capacitor 8.5.3 範本：`minSdkVersion 24`、`compileSdkVersion 36`、`targetSdkVersion 36`、AGP 8.13.0、Gradle 8.14.3、Java 21（`app/capacitor.build.gradle`）。npm workspaces 把套件 hoist 到根目錄，`capacitor.settings.gradle` 會指向 `../../../node_modules/@capacitor/...`，可正常運作。本計畫不改這些值，也不改 App 圖示與啟動畫面。 |
| 權限 | 範本已有 `INTERNET`；加上 `RECORD_AUDIO`、`MODIFY_AUDIO_SETTINGS`。Capacitor 的 `BridgeWebChromeClient.onPermissionRequest` 在網頁要求 `AUDIO_CAPTURE` 時同時請求這兩個權限，使用者允許後才 `grant`；拒絕時 `getUserMedia` 以 `NotAllowedError` 失敗，M3b 顯示「無法使用麥克風，請在系統或瀏覽器設定中允許麥克風權限」。 |
| `capacitorFileSaver` | `createCapacitorFileSaver(): FileSaver`（無參數，直接使用外掛）。先 `Filesystem.writeFile({ path: 'exports/<檔名>', data: <base64>, directory: Directory.Cache, recursive: true })`，再 `Share.share({ title: <檔名>, files: [uri], dialogTitle: '分享匯出的筆記' })`。原生平台的 `writeFile` 不收 Blob（型別雖是 `string \| Blob`，外掛註解寫明 Blob 只支援 Web），所以用 `FileReader.readAsDataURL` 轉 base64（`blobToBase64`，jsdom 也能跑）。空 Blob（空白筆記匯出成 Markdown／純文字時 M2 產生 `''`）直接回傳空字串、不經 `FileReader`：Chromium 對 0 位元組只回 `data:`（沒有逗號），若照常切掉前綴會把 `data:` 當成 base64 交給原生端而解碼失敗。範本的 FileProvider（`@xml/file_paths` 含 `cache-path`）讓分享目標讀得到快取檔。快取中的匯出檔不主動刪除：分享目標可能在 `share()` 回來之後才讀檔；同名匯出會覆寫，系統空間不足時會清快取。 |
| 取消分享 | 依 M2 約定：Android Share 外掛在分享選單被關閉時以 `Share canceled` reject（`navigator.share` 則是 `AbortError`），一律轉成 `new DOMException('使用者取消', 'AbortError')`，`NoteActions` 不顯示訊息；其他錯誤照原樣丟出（顯示「匯出失敗，請再試一次」）。注意：Android 外掛只在 App 沒有被切到背景時才判定為取消，若使用者挑了在同一畫面彈出的分享目標（例如「複製」），也可能被判為取消，結果只是不顯示「已匯出 …」，不會誤報失敗。 |
| `selectPlatform` | 依 M4 的建議：`Capacitor.isNativePlatform()` 為 true 時 `fileSaver = createCapacitorFileSaver()`、`canPrint = false`，並呼叫 `installBackgroundMicGuard()`；否則維持 M4 行為（有 `window.ocDesktop` → 桌面另存新檔，否則瀏覽器下載，`canPrint: true`）。Electron 與瀏覽器中 `@capacitor/core` 回報 `web`，不受影響。日後 iOS 也走同一分支。 |
| 背景中斷（**新增檔案，原契約未列；Task 7 Step 6 補進契約並回報**） | spec §8 要求「手機切到背景導致錄音中斷 → 回前景時提示「錄音已中斷」，已錄部分照常上傳」。但 Android 對背景 App 的麥克風只會送靜音、不會結束 track；M3b 的 `SegmentRecorder` 只在 track `ended` 時回報中斷，結果是不會提示，還會一直上傳靜音片段（語音模型對靜音可能產生雜訊文字）。因此新增 `apps/web/src/platform/backgroundMicGuard.ts`：`installBackgroundMicGuard({ target?, mediaDevices? }): () => void` 包住 `navigator.mediaDevices.getUserMedia` 記下麥克風 track，在 `visibilitychange`（hidden）或 Capacitor 的 `pause` 事件（Android activity `onPause` 時 Capacitor 對 `document` 送出）時，對每個仍 `live` 的 track **先送出 `ended` 再 `stop()`**。之後由 M3b 接手：`SegmentRecorder` 在 track 還有聲音時停掉當段 `MediaRecorder` 並交出已錄部分，`useRecorder` 在回到前景時顯示「錄音已中斷，已錄的部分會照常轉寫」（若送出當下頁面仍可見，提示會立即設定，回來時一樣看得到）。M3b 的 `defaultRecorderDeps.getUserMedia` 在呼叫當下才讀 `navigator.mediaDevices.getUserMedia`，所以包裝會生效。只在 Capacitor App 內安裝；`packages/core`、`Platform` 介面都不變。結果：在手機上，錄音中切到背景、關螢幕、來電或開啟分享選單都會結束錄音。這個包裝實質上是錄音的轉接層，是 spec §5「錄音不需轉接層」的唯一例外，且契約 §4「Web 入口與平台選擇」原本只列 `desktopFileSaver.ts`／`capacitorFileSaver.ts`／`global.d.ts`；因此 Task 7 Step 6 把它寫進契約（另一個 `docs:` commit），完成 Task 7 時向使用者回報。 |
| 系統列（**修改 M1 的 `index.html`**） | M1 的 viewport 帶 `viewport-fit=cover`，但樣式沒有 `env(safe-area-inset-*)`。Capacitor 8 的 `SystemBars`（預設 `insetsHandling: 'css'`）在 Android System WebView ≥ 140 看到 `cover` 時，會讓網頁畫到狀態列與導覽列底下，頂部的選單鈕與「錄製」會被狀態列蓋住。Task 5 把 viewport 改成 `width=device-width, initial-scale=1`：Capacitor 改為替 WebView 加上系統列的 padding（舊版 WebView 本來就是這樣）。網頁版與 Electron 沒有差別（桌面瀏覽器不看 `viewport-fit`；iPhone Safari 改回預設的安全區留白，反而正確）。 |
| Vite dev server | `apps/web/android` 位在 Vite root 之內：Vite 預設把所有 `.html` 當成相依掃描入口（實測會掃到 `android/app/src/main/assets/public/index.html` 這份 build 複本），也會監看 Gradle 產生的大量檔案。Task 4 設 `optimizeDeps.entries: ['index.html']` 與 `server.watch.ignored: ['**/android/**']`。`base` 與 `build` 不變（M4 的決定）。 |
| 後端連線 | App 的來源是 `https://localhost`（`server.androidScheme: 'https'`；M3a 預設 `ALLOWED_ORIGINS` 已含）。Android 9 起 App 預設禁止明文 HTTP，且頁面本身是 https，所以實機測試的後端網址必須是 **https**（例如依 `apps/api/README.md` 部署到 Fly.io／Render 的網址，且 `ALLOWED_ORIGINS` 含 `https://localhost`）。本計畫刻意不開 `usesCleartextTraffic`。 |
| PDF | Android WebView 沒有 `window.print()`：`canPrint: false` → M2 的 `ExportMenu` 不顯示 PDF。 |
| 已知限制（第一版接受） | (1) 刪除筆記的 `window.confirm` 由 Capacitor 的 `onJsConfirm` 顯示，按鈕固定為英文「OK／Cancel」。(2) 返回鍵：WebView 沒有上一頁時直接離開 App（抽屜開著也一樣）。(3) App 圖示與啟動畫面是 Capacitor 預設。Verification 會逐項記錄，第二版再處理。 |
| CLI 遙測 | Capacitor CLI 在互動式終端機**預設開啟**遙測（送出 app id 與執行的指令）。Task 2 以 `cap telemetry off` 關閉（寫在使用者的 Capacitor 設定檔，不在 repo 內）。 |
| npm audit | 安裝後 `npm audit` 會報 3 個 moderate（`@capacitor/cli` → `xcode` → `uuid`）。只影響開發機上的 CLI（產生 iOS 專案用），不會進入 App。**不要**執行 `npm audit fix --force`（會把 CLI 降到 8.4）。 |
| 建置指令 | `cap:sync` = `npm run build && cap sync android`；`android:run` = `npm run build && cap run android`（`cap run` 先 sync，再以 `gradlew assembleDebug` 建置、`native-run` 安裝並啟動）。`cap run` 的目標清單來自 `native-run android --list`，除了接上的手機，**也包含所有已建立的模擬器 AVD**（不論是否開著；Android Studio 的 Standard 設定常會建一台預設 AVD，Task 1 Step 6 也可能建一台），目標超過一個就在 sync 之後互動詢問 `Please choose a target device:`，代理的非互動 shell 無法回答（卡住或以非 0 結束）。因此一律以 `--target <序號>` 指定：`npm run android:run -w @oc/web -- --target "$SERIAL"`，`SERIAL` 取自 `adb devices`（先 `tr -d '\r'`：Git Bash 下 `adb.exe` 輸出 CRLF）；npm 把多出的參數接在 script 最後，實際執行 `npm run build && cap run android --target <序號>`。`android:open` = `cap open android`（Android Studio 不在 `C:\Program Files\Android\Android Studio` 時設環境變數 `CAPACITOR_ANDROID_STUDIO_PATH`；Task 1 Step 5 與 Task 10 Step 1 檢查 `studio64.exe` 是否存在）。三者在 `apps/web` 內執行，用 `npm run <script> -w @oc/web` 呼叫。 |
| 測試方式 | 外掛以 `vi.mock('@capacitor/filesystem')`、`vi.mock('@capacitor/share')`、`vi.mock('@capacitor/core')` 取代；`AndroidManifest.xml` 與 `index.html` 以 `node:fs` 讀檔驗證；`vite.config.ts` 的測試檔用 `// @vitest-environment node`（實測 esbuild 在 jsdom 下載入失敗：`Invariant violation: "new TextEncoder().encode("") instanceof Uint8Array" is incorrectly false`）。Gradle 建置與實機行為無法自動化，列在 Task 10、Task 11 的手動檢查。 |

本計畫新增的執行期套件只有契約列出的 `@capacitor/core`、`@capacitor/android`、`@capacitor/filesystem`、`@capacitor/share`；開發依賴 `@capacitor/cli`。

## iOS（延後到有 Mac 時）

spec §1、§10：iOS 需要 Mac 建置，第一版不做。本計畫的程式已替 iOS 預留：`Capacitor.isNativePlatform()` 在 iOS 也是 true（分享選單匯出、隱藏 PDF——WKWebView 同樣不支援列印、背景時結束麥克風），M3a 的 `ALLOWED_ORIGINS` 預設已含 `capacitor://localhost`。有 Mac 時另寫一份計畫，步驟如下（本計畫**不執行**）：

1. Mac 安裝 Capacitor 8 官方文件要求的 Xcode 版本；clone repo 後 `npm install`。
2. `npm install -w @oc/web @capacitor/ios@^8.5.3`（與其他 Capacitor 套件同主版本）。
3. `npm run build -w @oc/web && npm exec -w @oc/web -- cap add ios`（Capacitor 8 預設用 Swift Package Manager，不需要 CocoaPods）。
4. 在 `apps/web/ios/App/App/Info.plist` 加入 `NSMicrophoneUsageDescription`，文字「open-copilot 需要使用麥克風，把你說的話轉成文字。」，並加一個讀 Info.plist 的測試（比照本計畫的 `androidManifest.test.ts`）；`apps/web/package.json` 加 `"ios:sync": "npm run build && cap sync ios"`、`"ios:open": "cap open ios"`。
5. `npm run ios:sync -w @oc/web && npm run ios:open -w @oc/web`，在 Xcode → Signing & Capabilities 選開發團隊，接 iPhone 執行。
6. 依本計畫 Task 11 的手動檢查表在 iPhone 逐項確認。iOS 的 `MediaRecorder` 不支援 webm，會走 M3b `pickMimeType` 的 `audio/mp4`（`segment-N.mp4`），需確認 M3a 轉寫正常；請求的 Origin 應為 `capacitor://localhost`。

## File Structure

| 檔案 | 動作 | 單一職責 |
|---|---|---|
| `apps/web/package.json` | Modify | 加入 Capacitor 套件與 `cap:sync`／`android:open`／`android:run` |
| `apps/web/tsconfig.json` | Modify | 型別檢查納入 `capacitor.config.ts` |
| `apps/web/capacitor.config.ts` | Create | App 識別（`appId`、`appName`）、`webDir`、`androidScheme` |
| `apps/web/android/**` | Create（`cap add android` 產生） | Android Gradle 專案：`MainActivity`、Gradle wrapper、資源、範本 `.gitignore` |
| `apps/web/android/app/src/main/AndroidManifest.xml` | Modify | 宣告 `RECORD_AUDIO`、`MODIFY_AUDIO_SETTINGS` |
| `.gitignore` | Modify | 忽略 Android Studio 的 `apps/web/android/.idea/` |
| `apps/web/vite.config.ts` | Modify | dev server 只從 `index.html` 掃描相依、不監看 `android/` |
| `apps/web/index.html` | Modify | viewport 拿掉 `viewport-fit=cover` |
| `apps/web/src/platform/capacitorFileSaver.ts` | Create | 寫入 App 快取 → 系統分享選單；取消轉 `AbortError`；`blobToBase64` |
| `apps/web/src/platform/backgroundMicGuard.ts` | Create | App 暫停／隱藏時結束仍在錄音的麥克風 track |
| `apps/web/src/platform/selectPlatform.ts` | Modify | Capacitor 分支：分享選單 FileSaver、`canPrint: false`、安裝背景守衛 |
| `apps/web/src/capacitorConfig.test.ts` | Create | 驗證 `capacitor.config.ts` |
| `apps/web/src/androidManifest.test.ts` | Create | 驗證 Manifest 權限 |
| `apps/web/src/viteConfig.test.ts` | Create | 驗證 dev server 不碰 `android/` |
| `apps/web/src/indexHtml.test.ts` | Create | 驗證 viewport |
| `apps/web/src/platform/capacitorFileSaver.test.ts` | Create | 以假外掛驗證寫檔、分享、取消、錯誤、base64 |
| `apps/web/src/platform/backgroundMicGuard.test.ts` | Create | 以假 `mediaDevices`／`document` 驗證結束 track 的時機與順序 |
| `apps/web/src/platform/selectPlatform.test.ts` | Modify | 加測 Capacitor 分支與背景守衛接線 |
| `apps/web/e2e/mobile.spec.ts` | Create | Pixel 7 模擬：抽屜開關、沒有橫向捲動、主要按鈕在畫面內 |
| `package-lock.json` | Modify | Capacitor 套件 |
| `docs/superpowers/plans/2026-10-21-00-overview.md` | Modify | 契約 §4「Web 入口與平台選擇」記錄 `backgroundMicGuard.ts` 與 `selectPlatform` 呼叫它（Task 7 Step 6） |

不修改：`packages/**`、`apps/web/src/main.tsx`、`apps/desktop/**`、`apps/api/**`。

---

### Task 1: Android 建置環境（JDK 21、Android Studio、Android SDK、ANDROID_HOME）

**Files:** 無（只檢查與安裝工具，不修改 repo，不 commit）。

安裝軟體與設定使用者環境變數會改動這台電腦的系統設定，**由使用者親自執行**（安裝程式需要系統管理員權限與同意授權條款）；執行計畫的代理只負責檢查，不通過時停下來把缺少的項目告訴使用者，不得自行安裝或修改系統環境變數。Task 2–9 不需要 JDK 與 Android SDK：若使用者暫時無法安裝，記錄狀態後可以先做 Task 2–9，但 Task 10 開頭會再檢查一次，不通過就停止。

- [ ] **Step 1: 檢查目前狀態**

Run: `java -version 2>&1 | head -1; echo "JAVA_HOME=$JAVA_HOME"; echo "ANDROID_HOME=$ANDROID_HOME"`
Expected（撰寫計畫時這台機器的狀態）：

```
bash: java: command not found
JAVA_HOME=
ANDROID_HOME=
```

若第一行已是 `openjdk version "21.…"` 且兩個變數都有值，直接跳到 Step 5。

- [ ] **Step 2: 安裝 JDK 21（使用者執行）**

在 PowerShell 執行（安裝程式會跳出 UAC）：

```powershell
winget install --id Microsoft.OpenJDK.21 -e
```

Expected: `Successfully installed`（之前已安裝過時 winget 顯示 `Found an existing package already installed`，也算通過）。JDK 安裝在 `C:\Program Files\Microsoft\jdk-21.0.<修訂號>-hotspot\`（資料夾名稱的修訂號與 winget 顯示的版本號不同，以實際資料夾為準），安裝程式會把它的 `bin` 加進系統 PATH。不能用 winget 時，從 https://learn.microsoft.com/java/openjdk/download 下載 Windows x64 的 JDK 21 MSI 安裝。必須是 **21**：Capacitor 8 範本以 Java 21 編譯，且 Gradle 8.14.3 不能在更新的 JDK 25 上執行。

- [ ] **Step 3: 安裝 Android Studio 與 Android SDK（使用者執行）**

在 PowerShell 執行：

```powershell
winget install --id Google.AndroidStudio -e
```

Expected: `Successfully installed`（之前已安裝過時顯示 `Found an existing package already installed`，也算通過）。預設安裝在 `C:\Program Files\Android\Android Studio\`，`cap open android` 預設就找這裡的 `bin\studio64.exe`（Step 5 會檢查）。

安裝完成後開啟 Android Studio：

1. 第一次啟動的 Setup Wizard 選 **Standard**，在授權頁面逐項 **Accept**，按 Finish。SDK 會下載到 `%LOCALAPPDATA%\Android\Sdk`（Android SDK Platform、Build-Tools、Platform-Tools、Emulator）。
2. 歡迎畫面 → More Actions → **SDK Manager**：
   - SDK Platforms：確認 **Android 16.0（"Baklava"）API 36** 已勾選並安裝（範本的 `compileSdkVersion 36`）。
   - SDK Tools：確認 **Android SDK Platform-Tools** 已安裝；Pixel 手機另勾 **Google USB Driver**。按 Apply。
3. Settings → Build, Execution, Deployment → Build Tools → **Gradle** → Gradle JDK 選 Step 2 安裝的 JDK 21（只影響在 Android Studio 內建置；命令列建置用 `JAVA_HOME`）。

- [ ] **Step 4: 設定使用者環境變數（使用者執行）**

在 PowerShell 先找出 JDK 21 的資料夾：

```powershell
$jdk = (Get-ChildItem 'C:\Program Files\Microsoft' -Directory -Filter 'jdk-21*' -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1).FullName
$jdk
```

Expected: `C:\Program Files\Microsoft\jdk-21.0.<修訂號>-hotspot`

停止條件：沒有任何輸出 → `$jdk` 是 `$null`，JDK 21 沒有安裝（回到 Step 2）。此時**不要**執行下面的指令，否則 `JAVA_HOME` 會被設成空值。

在**同一個** PowerShell 視窗接著執行（沿用上面的 `$jdk`）：

```powershell
[Environment]::SetEnvironmentVariable('JAVA_HOME', $jdk, 'User')
[Environment]::SetEnvironmentVariable('ANDROID_HOME', "$env:LOCALAPPDATA\Android\Sdk", 'User')
```

Expected: 無輸出。

然後關閉**所有**終端機視窗，並重新啟動開啟它們的程式（Windows Terminal、VS Code、Claude Code 等）：新的環境變數只會傳給之後才啟動的程序。

- [ ] **Step 5: 驗證（在新開的 Git Bash）**

Run:

```bash
java -version 2>&1 | head -1
"$(cygpath -u "$JAVA_HOME")/bin/java" -version 2>&1 | head -1
ls "$(cygpath -u "$ANDROID_HOME")/licenses" "$(cygpath -u "$ANDROID_HOME")/platforms"
"$(cygpath -u "$ANDROID_HOME")/platform-tools/adb.exe" version | head -1
ls "$(cygpath -u "${CAPACITOR_ANDROID_STUDIO_PATH:-C:/Program Files/Android/Android Studio/bin/studio64.exe}")"
```

最後一行與 `cap open android` 找 Android Studio 的順序相同：有設 `CAPACITOR_ANDROID_STUDIO_PATH` 就檢查它，否則檢查預設安裝位置。

Expected:

```
openjdk version "21.0.…" … LTS
openjdk version "21.0.…" … LTS
/c/Users/user/AppData/Local/Android/Sdk/licenses:
android-sdk-license …

/c/Users/user/AppData/Local/Android/Sdk/platforms:
android-36 …
Android Debug Bridge version 1.0.41
/c/Program Files/Android/Android Studio/bin/studio64.exe
```

（最後一行在互動式終端機中可能被加上單引號；有設 `CAPACITOR_ANDROID_STUDIO_PATH` 時是它指向的路徑。）

停止條件（任一成立就停下來，告訴使用者是哪一項，等使用者處理後再從 Step 5 重跑）：
- 第一行是 `bash: java: command not found` 或版本不是 21 → Step 2 未完成，或終端機沒有重開。
- 第二行出現 `cygpath: can't convert empty path` 或 `No such file or directory` → `JAVA_HOME` 沒設好（Step 4）。
- 列 `licenses`／`platforms` 的 `ls` 報 `No such file or directory`，或 `platforms` 底下沒有 `android-36`、`licenses` 底下沒有 `android-sdk-license` → `ANDROID_HOME` 沒設好，或 Step 3 的 SDK／授權未完成。
- `adb.exe` 不存在 → Platform-Tools 未安裝（Step 3）。
- 最後一行是 `ls: cannot access '…/studio64.exe': No such file or directory` → Android Studio 沒有在 Step 3 安裝，或裝在別的位置。沒裝就回到 Step 3；裝在別處時，由使用者在 PowerShell 把實際的 `studio64.exe` 設成使用者環境變數（把 `<Android Studio 安裝資料夾>` 換成實際路徑），再關閉並重開所有終端機：

```powershell
[Environment]::SetEnvironmentVariable('CAPACITOR_ANDROID_STUDIO_PATH', '<Android Studio 安裝資料夾>\bin\studio64.exe', 'User')
```

Expected: 無輸出。重開後在 Git Bash 執行 `ls "$(cygpath -u "$CAPACITOR_ANDROID_STUDIO_PATH")"`，Expected: 印出該 `studio64.exe` 的路徑；然後從 Step 5 重跑。

- [ ] **Step 6: 準備 Android 手機（使用者執行）**

1. 手機：設定 → 關於手機 → 連按「版本號碼」7 次開啟開發人員選項；設定 → 系統 → 開發人員選項 → 開啟「USB 偵錯」。
2. 用 USB 接上電腦，手機跳出「允許 USB 偵錯嗎？」時勾選「一律允許這部電腦」→ 允許。

Run: `"$(cygpath -u "$ANDROID_HOME")/platform-tools/adb.exe" devices`
Expected:

```
List of devices attached
<序號>	device
```

停止條件：清單是空的 → 安裝手機廠牌的 USB 驅動（Pixel 用 Step 3 的 Google USB Driver），換一條可傳資料的線；狀態是 `unauthorized` → 在手機上按允許。spec §9 要求實機；只有模擬器時，可在 Android Studio 的 Device Manager 建一台 API 36 的模擬器並在 Extended Controls → Microphone 開啟「Virtual microphone uses host audio input」暫代，但 Task 11 的回報必須註明不是實機（模擬器要先在 Device Manager 啟動，`adb devices` 才會列出 `emulator-5554	device`）。注意：每建立一台 AVD（包括 Android Studio Standard 設定自動建立的那台），`cap run` 就多一個目標；Task 10、Task 11 一律以 `--target <序號>` 指定裝置，不受影響。

---

### Task 2: Capacitor 套件、`capacitor.config.ts` 與 npm scripts

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/tsconfig.json`
- Create: `apps/web/capacitor.config.ts`
- Test: `apps/web/src/capacitorConfig.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`apps/web/src/capacitorConfig.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import config from '../capacitor.config';

describe('capacitor.config', () => {
  it('builds the Android app from dist and serves it from https://localhost', () => {
    expect(config).toEqual({
      appId: 'com.think4u.opencopilot',
      appName: 'open-copilot',
      webDir: 'dist',
      server: { androidScheme: 'https' },
    });
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/web -- src/capacitorConfig.test.ts`
Expected: FAIL，`Error: Failed to resolve import "../capacitor.config" from "src/capacitorConfig.test.ts". Does the file exist?`

- [ ] **Step 3: 加入 Capacitor 套件與 scripts 並安裝**

整個檔案換成（M1 的內容 + Capacitor 依賴 + 三個 scripts）：

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
    "e2e": "playwright test",
    "cap:sync": "npm run build && cap sync android",
    "android:open": "cap open android",
    "android:run": "npm run build && cap run android"
  },
  "dependencies": {
    "@capacitor/android": "^8.5.3",
    "@capacitor/core": "^8.5.3",
    "@capacitor/filesystem": "^8.1.5",
    "@capacitor/share": "^8.0.3",
    "@oc/core": "*",
    "react": "^19.3.1",
    "react-dom": "^19.3.1"
  },
  "devDependencies": {
    "@capacitor/cli": "^8.5.3",
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

`cap:sync` 與 `android:run` 都先 `vite build`，避免把舊的 `dist` 複製進 App；`cap run` 本身會先做 sync。

Run: `npm install`
Expected: `added … packages`；可能附帶 `3 moderate severity vulnerabilities`（`@capacitor/cli` → `xcode` → `uuid`，只影響開發機上的 CLI）。**不要**執行 `npm audit fix --force`。

Run: `npm ls -w @oc/web @capacitor/core @capacitor/cli @capacitor/android @capacitor/filesystem @capacitor/share`
Expected（版本號可能是更新的 8.x）：

```
open-copilot@0.0.0 D:\git\open-copilot
`-- @oc/web@0.0.0 -> .\apps\web
  +-- @capacitor/android@8.5.3
  | `-- @capacitor/core@8.5.3 deduped
  +-- @capacitor/cli@8.5.3
  +-- @capacitor/core@8.5.3
  +-- @capacitor/filesystem@8.1.5
  | `-- @capacitor/core@8.5.3 deduped
  `-- @capacitor/share@8.0.3
    `-- @capacitor/core@8.5.3 deduped
```

停止條件：任何一個不是 `8.` 開頭，或出現 `UNMET PEER DEPENDENCY`／`invalid` → 停下來回報。

- [ ] **Step 4: 建立 `capacitor.config.ts` 並納入型別檢查**

`apps/web/capacitor.config.ts`：

```ts
import type { CapacitorConfig } from '@capacitor/cli';

/** Capacitor (Android) shell around the Vite build in dist/. */
const config: CapacitorConfig = {
  appId: 'com.think4u.opencopilot',
  appName: 'open-copilot',
  webDir: 'dist',
  server: {
    // The app is served from https://localhost: a secure context (getUserMedia works) and an
    // origin M3a's default ALLOWED_ORIGINS already accepts.
    androidScheme: 'https',
  },
};

export default config;
```

`androidScheme: 'https'` 在 Capacitor 8 已是預設值，仍明寫出來：它決定 App 的 Origin，後端 CORS 依賴它。

整個檔案換成（M1 的 include 加上 `capacitor.config.ts`）：

`apps/web/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "include": [
    "src",
    "e2e",
    "vite.config.ts",
    "vitest.config.ts",
    "playwright.config.ts",
    "capacitor.config.ts"
  ]
}
```

- [ ] **Step 5: 執行測試與型別檢查，確認通過**

Run: `npm test -w @oc/web && npm run typecheck -w @oc/web`
Expected: `Test Files  3 passed (3)`、`Tests  7 passed (7)`；`tsc --noEmit` 無錯誤輸出。

- [ ] **Step 6: 關閉 Capacitor CLI 遙測並確認 CLI 可用**

Run: `npm exec -w @oc/web -- cap telemetry off`
Expected: `[success] You have opted out of telemetry on this machine.`（已經關閉過時為 `[info] Telemetry is already off`）。這只寫入使用者的 Capacitor 設定檔，repo 沒有變動；若使用者明確表示要保留遙測，略過本指令。

Run: `npm exec -w @oc/web -- cap --version`
Expected: `8.5.3`（或更新的 8.x）。

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/tsconfig.json apps/web/capacitor.config.ts apps/web/src/capacitorConfig.test.ts package-lock.json
git commit -m "feat(web): add Capacitor config and packages"
```

---

### Task 3: 加入 Android 專案並宣告麥克風權限

**Files:**
- Create: `apps/web/android/`（`cap add android` 產生的整個 Gradle 專案）
- Modify: `apps/web/android/app/src/main/AndroidManifest.xml`
- Modify: `.gitignore`
- Test: `apps/web/src/androidManifest.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`apps/web/src/androidManifest.test.ts`：

```ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** apps/web/android/app/src/main/AndroidManifest.xml, created by `cap add android`. */
const MANIFEST = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../android/app/src/main/AndroidManifest.xml',
);

function permissions(): string[] {
  const xml = readFileSync(MANIFEST, 'utf8');
  return [...xml.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)].map((match) => match[1]);
}

describe('AndroidManifest.xml', () => {
  it('declares what recording and uploading need', () => {
    // Capacitor's WebChromeClient asks for RECORD_AUDIO and MODIFY_AUDIO_SETTINGS when the page
    // calls getUserMedia({ audio: true }); Android only prompts for permissions the app declares.
    expect(permissions()).toEqual(
      expect.arrayContaining([
        'android.permission.INTERNET',
        'android.permission.RECORD_AUDIO',
        'android.permission.MODIFY_AUDIO_SETTINGS',
      ]),
    );
  });

  it('asks for nothing else', () => {
    expect(permissions()).toHaveLength(3);
  });
});
```

路徑用 `fileURLToPath(import.meta.url)` + `node:path` 組出來：實測在 Vitest 的 jsdom 環境中 `new URL('../x', import.meta.url)` 會被解析成 `http://localhost:3000/...`，不能用。

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/web -- src/androidManifest.test.ts`
Expected: FAIL，`Tests  2 failed (2)`，兩個都是 `Error: ENOENT: no such file or directory, open 'D:\git\open-copilot\apps\web\android\app\src\main\AndroidManifest.xml'`。

- [ ] **Step 3: 建置網頁並產生 Android 專案**

`cap add` 需要 `webDir`（`dist`）已存在。這一步不需要 JDK／Android SDK。

Run: `ls apps/web/android 2>&1 | head -1`
Expected: `ls: cannot access 'apps/web/android': No such file or directory`。若目錄已存在（前一次執行留下），先用 `git status --short apps/web/android` 確認它是 `??`（未追蹤），再 `rm -rf apps/web/android`；若它已被追蹤，停下來回報。

Run: `npm run build -w @oc/web && npm exec -w @oc/web -- cap add android`
Expected: 先是 `vite build` 的輸出與 `✓ built in`，接著：

```
√ Adding native android project in android in …ms
√ add in …ms
√ Copying web assets from dist to android\app\src\main\assets\public in …ms
√ Creating capacitor.config.json in android\app\src\main\assets in …
√ copy android in …ms
√ Updating Android plugins in …
[info] Found 2 Capacitor plugins for android:
       @capacitor/filesystem@8.1.5
       @capacitor/share@8.0.3
√ update android in …ms
√ Syncing Gradle in …
[success] android platform added!
```

Run: `cat apps/web/android/capacitor.settings.gradle && grep -E "minSdkVersion|compileSdkVersion|targetSdkVersion" apps/web/android/variables.gradle && grep distributionUrl apps/web/android/gradle/wrapper/gradle-wrapper.properties`
Expected:

```
// DO NOT EDIT THIS FILE! IT IS GENERATED EACH TIME "capacitor update" IS RUN
include ':capacitor-android'
project(':capacitor-android').projectDir = new File('../../../node_modules/@capacitor/android/capacitor')

include ':capacitor-filesystem'
project(':capacitor-filesystem').projectDir = new File('../../../node_modules/@capacitor/filesystem/android')

include ':capacitor-share'
project(':capacitor-share').projectDir = new File('../../../node_modules/@capacitor/share/android')
    minSdkVersion = 24
    compileSdkVersion = 36
    targetSdkVersion = 36
distributionUrl=https\://services.gradle.org/distributions/gradle-8.14.3-all.zip
```

（路徑經過三層 `..` 指向根目錄的 `node_modules`，這是 npm workspaces hoist 的結果，正常。）

- [ ] **Step 4: 再執行測試，確認仍然失敗（缺少麥克風權限）**

Run: `npm test -w @oc/web -- src/androidManifest.test.ts`
Expected: FAIL，`Tests  2 failed (2)`：
- `declares what recording and uploading need` → `AssertionError: expected [ 'android.permission.INTERNET' ] to deeply equal ArrayContaining{…}`
- `asks for nothing else` → `AssertionError: expected [ 'android.permission.INTERNET' ] to have a length of 3 but got 1`

- [ ] **Step 5: 宣告麥克風權限**

整個檔案換成（`cap add` 產生的內容，只在最後加兩個權限與一行註解）：

`apps/web/android/app/src/main/AndroidManifest.xml`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme">

        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"
            android:name=".MainActivity"
            android:label="@string/title_activity_main"
            android:theme="@style/AppTheme.NoActionBarLaunch"
            android:launchMode="singleTask"
            android:exported="true">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

        </activity>

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths"></meta-data>
        </provider>
    </application>

    <!-- Permissions -->

    <uses-permission android:name="android.permission.INTERNET" />
    <!-- Recording (M3b): Capacitor requests both when the page calls getUserMedia({ audio: true }). -->
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
</manifest>
```

若 `cap add` 產生的 Manifest 與上面除了最後三行之外有任何不同（代表 Capacitor 範本已更新），保留新範本的內容，只在 `INTERNET` 那行之後加上這三行，並在回報中說明。`FileProvider` 是 Task 6 分享匯出檔要用的，不可刪除。`cap sync` 不會覆寫這個檔案（已實測）。

- [ ] **Step 6: 執行測試，確認通過**

Run: `npm test -w @oc/web -- src/androidManifest.test.ts`
Expected: `Tests  2 passed (2)`

- [ ] **Step 7: 忽略 Android Studio 的專案設定**

`android/.gitignore`（範本）只排除 `.idea` 底下的部分檔案；用 Android Studio 開啟後會多出 `misc.xml`、`compiler.xml` 等，整個 `.idea/` 交給根 `.gitignore` 排除。

整個檔案換成（M4 的內容 + 最後一行）：

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
apps/web/android/.idea/
```

- [ ] **Step 8: 確認哪些檔案會進版控**

Run: `git status --short --untracked-files=all -- apps/web/android | wc -l`
Expected: `53`（18 個專案檔 + 35 個 `res/` 資源檔）。

Run: `git status --short --untracked-files=all -- apps/web/android | grep -E "assets/public|capacitor-cordova-android-plugins|capacitor\.(config|plugins)\.json|/build/" ; echo "exit=$?"`
Expected: 只有一行 `exit=1`（grep 沒有找到任何一行：複製進去的網頁、產生的設定與 build 輸出都被忽略）。

- [ ] **Step 9: 執行全部 web 測試**

Run: `npm test -w @oc/web`
Expected: `Test Files  4 passed (4)`、`Tests  9 passed (9)`

- [ ] **Step 10: 加入暫存區並保留 `gradlew` 的執行權限**

Windows 上的 Git（`core.fileMode=false`）新增檔案時一律記成 `100644`，`apps/web/android/gradlew` 會失去執行權限；之後在 macOS／Linux clone（例如 iOS 那台 Mac），`cap run android` 執行 `./gradlew` 就會 `Permission denied`（Capacitor CLI 的錯誤訊息本身就寫著 `This can happen if the Android platform was added on a Windows machine`），違反契約「npm scripts 必須跨平台」。所以在 index 中明確設成可執行：

Run:

```bash
git add .gitignore apps/web/android apps/web/src/androidManifest.test.ts
git add --chmod=+x apps/web/android/gradlew
git ls-files -s apps/web/android/gradlew
```

Expected: 最後一行以 `100755` 開頭，例如 `100755 <雜湊> 0	apps/web/android/gradlew`。若是 `100644`，停下來回報。（`core.fileMode=false` 時 Git 不比對工作目錄的執行位元，所以之後 `git status` 不會因此出現變動。）

- [ ] **Step 11: Commit**

```bash
git commit -m "feat(web): add Capacitor Android project with microphone permissions"
```

---

### Task 4: Vite dev server 不碰 `android/`

**Files:**
- Modify: `apps/web/vite.config.ts`
- Test: `apps/web/src/viteConfig.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`apps/web/src/viteConfig.test.ts`：

```ts
// @vitest-environment node
// (esbuild, which vite.config.ts pulls in, refuses to load under jsdom.)
import { describe, expect, it } from 'vitest';
import config from '../vite.config';

describe('vite.config', () => {
  it('keeps the dev server out of the Android project', () => {
    // Only index.html is an entry, not the build copy in android/app/src/main/assets/public.
    expect(config.optimizeDeps?.entries).toEqual(['index.html']);
    // Gradle writes thousands of files under android/; do not watch them.
    expect(config.server?.watch?.ignored).toEqual(['**/android/**']);
  });
});
```

第一行的 `// @vitest-environment node` 讓這個檔案改在 node 環境執行（其餘測試仍是 jsdom）；setup 檔的 `fake-indexeddb/auto` 在 node 環境同樣可用。

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/web -- src/viteConfig.test.ts`
Expected: FAIL，`AssertionError: expected undefined to deeply equal [ 'index.html' ]`

- [ ] **Step 3: 實作**

整個檔案換成（M1 的內容 + `server.watch` 與 `optimizeDeps`）：

`apps/web/vite.config.ts`：

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // apps/web/android is the Capacitor project; Gradle writes thousands of files there.
    watch: { ignored: ['**/android/**'] },
  },
  // Pre-bundle from the app entry only, not from the build copy in android/app/src/main/assets.
  optimizeDeps: { entries: ['index.html'] },
  build: {
    // main.tsx uses top-level await.
    target: 'es2022',
    // Tiptap + React form one ~650 kB chunk; that is expected for this app.
    chunkSizeWarningLimit: 1000,
  },
});
```

`server.watch.ignored` 會與 Vite 內建的忽略清單（`.git`、`node_modules`、`test-results`）合併；`optimizeDeps.entries` 只影響 dev server 的相依預先打包，`vite build` 的輸出不變。

- [ ] **Step 4: 執行測試與型別檢查，確認通過**

Run: `npm test -w @oc/web -- src/viteConfig.test.ts && npm run typecheck -w @oc/web`
Expected: `Tests  1 passed (1)`；`tsc --noEmit` 無錯誤輸出。

- [ ] **Step 5: 確認 dev server 只掃描 `index.html`**

Run: `rm -rf node_modules/.vite apps/web/node_modules/.vite; (cd apps/web && NO_COLOR=1 DEBUG=vite:deps timeout 15 node ../../node_modules/vite/bin/vite.js --port 5199 --strictPort 2>&1 | grep -A2 "Crawling dependencies")`
Expected:

```
… vite:deps Crawling dependencies using entries:
  D:/git/open-copilot/apps/web/index.html
```

只有這一個入口（Task 4 之前還會多一行 `…/apps/web/android/app/src/main/assets/public/index.html`）。`NO_COLOR=1` 不可省略：Vite 以 picocolors 把每個入口包上 dim 色碼，而 picocolors 在 `win32` 上即使輸出被 pipe 也會上色，沒有它時入口行會是 `\x1b[2mD:/git/open-copilot/apps/web/index.html\x1b[22m`（已實測）。`timeout 15` 會在 15 秒後結束這個暫時的 dev server（直接執行 `node …/vite.js` 而不是 `npx vite`，`timeout` 才能確實結束它）；port 5199 只是避免和其他正在跑的 5173 衝突。若 `ls node_modules/vite/bin/vite.js` 找不到（vite 沒有被 hoist 到根目錄），把指令中的 `../../node_modules/vite/bin/vite.js` 換成 `node_modules/vite/bin/vite.js`。結束後 Run: `netstat -ano | grep ":5199.*LISTEN" || echo "port free"`，Expected: `port free`。

- [ ] **Step 6: 網頁版端對端測試不受影響**

Run: `npm run e2e -w @oc/web`
Expected: `11 passed`（與 M4 結束時相同的 11 個測試）。

- [ ] **Step 7: Commit**

```bash
git add apps/web/vite.config.ts apps/web/src/viteConfig.test.ts
git commit -m "chore(web): keep the Vite dev server out of the Android project"
```

---

### Task 5: 系統列：`index.html` 不再要求 `viewport-fit=cover`

**Files:**
- Modify: `apps/web/index.html`
- Test: `apps/web/src/indexHtml.test.ts`

- [ ] **Step 1: 寫失敗的測試**

`apps/web/src/indexHtml.test.ts`：

```ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = resolve(dirname(fileURLToPath(import.meta.url)), '../index.html');

describe('index.html', () => {
  it('does not ask for edge-to-edge (viewport-fit=cover): the layout has no safe-area padding', () => {
    // With viewport-fit=cover, Capacitor 8 on Android WebView >= 140 draws the page under the
    // status and navigation bars; without it, Capacitor pads the WebView instead.
    const viewport = readFileSync(INDEX_HTML, 'utf8').match(
      /<meta name="viewport" content="([^"]*)"/,
    )?.[1];
    expect(viewport).toBe('width=device-width, initial-scale=1');
  });
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/web -- src/indexHtml.test.ts`
Expected: FAIL，`AssertionError: expected 'width=device-width, initial-scale=1, …' to be 'width=device-width, initial-scale=1' // Object.is equality`

- [ ] **Step 3: 實作**

整個檔案換成（M1 的內容，只有 viewport 少了 `, viewport-fit=cover`）：

`apps/web/index.html`：

```html
<!doctype html>
<html lang="zh-Hant-TW">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#c026d3" />
    <title>open-copilot</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `npm test -w @oc/web`
Expected: `Test Files  6 passed (6)`、`Tests  11 passed (11)`

- [ ] **Step 5: Commit**

```bash
git add apps/web/index.html apps/web/src/indexHtml.test.ts
git commit -m "feat(web): let Capacitor keep the app clear of the Android system bars"
```

---

### Task 6: 分享選單 FileSaver `createCapacitorFileSaver`

**Files:**
- Create: `apps/web/src/platform/capacitorFileSaver.ts`
- Test: `apps/web/src/platform/capacitorFileSaver.test.ts`

- [ ] **Step 1: 寫失敗的測試**

jsdom 沒有原生外掛，`@capacitor/filesystem` 與 `@capacitor/share` 以 `vi.mock` 換成 spy（`vi.hoisted` 讓 spy 在被提升的 `vi.mock` factory 中可用）。jsdom 26 的 `Blob` 沒有 `arrayBuffer()`，但 `FileReader` 可用，所以實作用 `FileReader.readAsDataURL`；預期的 base64 以 Node 的 `Buffer` 計算。`afterEach` 用 `mockReset()`：Vitest 3 會把 spy 還原成 `vi.fn(...)` 給的實作，並丟掉沒用到的 `mock*Once`。

`apps/web/src/platform/capacitorFileSaver.test.ts`：

```ts
import type { WriteFileOptions } from '@capacitor/filesystem';
import type { ShareOptions } from '@capacitor/share';
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  blobToBase64,
  createCapacitorFileSaver,
  EXPORT_DIR,
  SHARE_DIALOG_TITLE,
} from './capacitorFileSaver';

// The native plugins do not exist in jsdom; replace them with spies.
const { CACHE_URI, writeFile, share } = vi.hoisted(() => {
  const uri = 'file:///data/user/0/com.think4u.opencopilot/cache/exports/%E9%80%B1.md';
  return {
    CACHE_URI: uri,
    writeFile: vi.fn(async (_options: WriteFileOptions) => ({ uri })),
    share: vi.fn(async (_options: ShareOptions) => ({ activityType: 'com.google.android.gm' })),
  };
});
vi.mock('@capacitor/filesystem', () => ({ Directory: { Cache: 'CACHE' }, Filesystem: { writeFile } }));
vi.mock('@capacitor/share', () => ({ Share: { share } }));

const base64 = (bytes: string | Uint8Array) =>
  (typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes)).toString('base64');

afterEach(() => {
  // Back to the implementations above, dropping unused mock*Once values.
  writeFile.mockReset();
  share.mockReset();
});

describe('createCapacitorFileSaver', () => {
  it('writes the file into the app cache as base64, then opens the share sheet', async () => {
    const blob = new Blob(['# 週會紀錄\n'], { type: 'text/markdown;charset=utf-8' });
    await createCapacitorFileSaver().save('週會紀錄.md', blob);

    expect(writeFile).toHaveBeenCalledWith({
      path: `${EXPORT_DIR}/週會紀錄.md`,
      data: base64('# 週會紀錄\n'),
      directory: 'CACHE',
      recursive: true,
    });
    expect(share).toHaveBeenCalledWith({
      title: '週會紀錄.md',
      files: [CACHE_URI],
      dialogTitle: SHARE_DIALOG_TITLE,
    });
    expect(writeFile.mock.invocationCallOrder[0]).toBeLessThan(share.mock.invocationCallOrder[0]);
  });

  it('keeps binary files (Word) byte for byte', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80, 0x7f]);
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await createCapacitorFileSaver().save('週會紀錄.docx', blob);

    expect(writeFile.mock.calls[0][0].data).toBe(base64(bytes));
  });

  it.each([
    ['Android share sheet closed', new Error('Share canceled')],
    ['web share dialog closed', new DOMException('Share canceled', 'AbortError')],
  ])('turns a cancel (%s) into AbortError so NoteActions stays quiet', async (_case, error) => {
    share.mockRejectedValueOnce(error);
    await expect(
      createCapacitorFileSaver().save('a.txt', new Blob(['a'], { type: 'text/plain' })),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('passes other share failures on to the caller', async () => {
    share.mockRejectedValueOnce(new Error("Can't share while sharing is in progress"));
    const saving = createCapacitorFileSaver().save('a.txt', new Blob(['a']));
    await expect(saving).rejects.toThrow("Can't share while sharing is in progress");
    await expect(saving).rejects.not.toMatchObject({ name: 'AbortError' });
  });

  it('does not open the share sheet when the file cannot be written', async () => {
    writeFile.mockRejectedValueOnce(new Error('No space left on device'));
    await expect(createCapacitorFileSaver().save('a.txt', new Blob(['a']))).rejects.toThrow(
      'No space left on device',
    );
    expect(share).not.toHaveBeenCalled();
  });
});

describe('blobToBase64', () => {
  it('encodes text and binary blobs without the data: URL prefix', async () => {
    expect(await blobToBase64(new Blob(['內文'], { type: 'text/plain;charset=utf-8' }))).toBe(
      base64('內文'),
    );
    expect(await blobToBase64(new Blob([new Uint8Array([0, 255])]))).toBe('AP8=');
  });

  it('encodes an empty blob as an empty string', async () => {
    expect(await blobToBase64(new Blob([]))).toBe('');
  });

  it('still returns an empty string where FileReader gives a bare "data:" (Chromium)', async () => {
    // Chromium's FileReader reads a zero-byte blob as "data:" (no comma); jsdom does not.
    const read = vi
      .spyOn(FileReader.prototype, 'readAsDataURL')
      .mockImplementation(function (this: FileReader) {
        Object.defineProperty(this, 'result', { configurable: true, value: 'data:' });
        this.dispatchEvent(new Event('load'));
      });
    try {
      expect(await blobToBase64(new Blob([]))).toBe('');
    } finally {
      read.mockRestore();
    }
  });
});
```

最後一個測試模擬 Android WebView（Chromium）讀空 Blob 的結果：空白筆記匯出成 Markdown／純文字時，M2 的 `toMarkdown`／`toTxt` 回傳 `''`，Blob 是 0 位元組。jsdom 會回 `data:application/octet-stream;base64,`，所以上一個測試抓不到這個情況；若照抄前綴切法，會把 `data:` 本身當成 base64 交給 `Filesystem.writeFile`，Android 解碼失敗而顯示「匯出失敗，請再試一次」。（已實測：只做「切掉第一個逗號之前」的實作會以 `expected 'data:' to be ''` 失敗。）

`Share canceled` 與 `Can't share while sharing is in progress` 是 `@capacitor/share` 8.0.3 Android 原始碼（`SharePlugin.java`）中實際的 reject 訊息。

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/web -- src/platform/capacitorFileSaver.test.ts`
Expected: FAIL，`Error: Failed to resolve import "./capacitorFileSaver" from "src/platform/capacitorFileSaver.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`apps/web/src/platform/capacitorFileSaver.ts`：

```ts
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { FileSaver } from '@oc/core';

/** Exports are written to <app cache>/exports/ before they are shared. */
export const EXPORT_DIR = 'exports';
/** Title of Android's share sheet. */
export const SHARE_DIALOG_TITLE = '分享匯出的筆記';

/**
 * Saves exports in the Capacitor app: the file goes into the app's cache directory, then the
 * system share sheet lets the user send it to Drive, Gmail, LINE, Files…
 */
export function createCapacitorFileSaver(): FileSaver {
  return {
    async save(filename, data) {
      // Native Filesystem.writeFile takes binary data only as base64 (Blob is web-only).
      const { uri } = await Filesystem.writeFile({
        path: `${EXPORT_DIR}/${filename}`,
        data: await blobToBase64(data),
        directory: Directory.Cache,
        recursive: true,
      });
      try {
        await Share.share({ title: filename, files: [uri], dialogTitle: SHARE_DIALOG_TITLE });
      } catch (error) {
        // M2 convention: closing the share sheet is a cancel, not a failure.
        if (isShareCancel(error)) throw new DOMException('使用者取消', 'AbortError');
        throw error;
      }
    },
  };
}

/** The blob as base64, without the `data:…;base64,` prefix. */
export function blobToBase64(blob: Blob): Promise<string> {
  // An empty note exports to an empty blob. Chromium reads that as a bare "data:" (no comma),
  // which Filesystem.writeFile on Android cannot decode.
  if (blob.size === 0) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const comma = dataUrl.indexOf(',');
      resolve(comma === -1 ? '' : dataUrl.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Android's Share plugin rejects with "Share canceled"; navigator.share with an AbortError. */
function isShareCancel(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  return name === 'AbortError' || (typeof message === 'string' && /cancel/i.test(message));
}
```

說明：
- 檔名來自 M2 的 `toFilename`（已去除 `\/:*?"<>|` 與控制字元），所以 `exports/<檔名>` 不會跳出快取目錄；`recursive: true` 讓第一次匯出時自動建立 `exports`。
- `title` 會成為 Android 分享意圖的 `EXTRA_SUBJECT`（例如寄信時的主旨）；`dialogTitle` 是分享選單標題。
- `blobToBase64` 對空 Blob 直接回傳 `''`（不經 `FileReader`），並且不假設 data URL 一定有逗號：沒有逗號時一律視為沒有內容。`@capacitor/filesystem` 8.1.5 的 Android 端只拒絕缺少 `data` 的呼叫（`getString("data") ?: return null`），`data: ''` 照常寫出 0 位元組的檔案。
- `Filesystem.writeFile` 回傳的 `uri` 是 `file://`；`@capacitor/share` 在 Android 會經範本的 FileProvider（`${applicationId}.fileprovider`）轉成 `content://` 並授予讀取權限，分享目標看到的檔名就是 `<檔名>`。

- [ ] **Step 4: 執行測試與型別檢查，確認通過**

Run: `npm test -w @oc/web -- src/platform/capacitorFileSaver.test.ts && npm run typecheck -w @oc/web`
Expected: `Tests  9 passed (9)`；`tsc --noEmit` 無錯誤輸出。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/platform/capacitorFileSaver.ts apps/web/src/platform/capacitorFileSaver.test.ts
git commit -m "feat(web): add Capacitor share-sheet FileSaver"
```

---

### Task 7: 背景時結束麥克風 `installBackgroundMicGuard`

**Files:**
- Create: `apps/web/src/platform/backgroundMicGuard.ts`
- Test: `apps/web/src/platform/backgroundMicGuard.test.ts`
- Modify: `docs/superpowers/plans/2026-10-21-00-overview.md`（Step 6，契約同步）

- [ ] **Step 1: 寫失敗的測試**

jsdom 沒有 `navigator.mediaDevices`，也無法真的切到背景，所以 `target`（代替 `document`）與 `mediaDevices` 都以參數注入假物件。假 track 的 `stop()` 與真的一樣只改 `readyState`、**不**觸發 `ended`。

`apps/web/src/platform/backgroundMicGuard.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installBackgroundMicGuard, type VisibilityTarget } from './backgroundMicGuard';

/** A microphone track stand-in; stop() ends it without firing `ended`, like the real one. */
function fakeTrack() {
  const track = Object.assign(new EventTarget(), {
    kind: 'audio',
    readyState: 'live' as MediaStreamTrackState,
    stop: vi.fn(() => {
      track.readyState = 'ended';
    }),
  });
  return track;
}

/** jsdom has no navigator.mediaDevices; this one hands out one fake track per call. */
function fakeMediaDevices() {
  const tracks: ReturnType<typeof fakeTrack>[] = [];
  const getUserMedia = vi.fn(async (_constraints?: MediaStreamConstraints) => {
    const track = fakeTrack();
    tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  });
  const mediaDevices = { getUserMedia } as unknown as MediaDevices;
  return { mediaDevices, getUserMedia, tracks };
}

/** A document stand-in whose visibilityState the test controls. */
function fakeDocument() {
  const target = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
  });
  const setVisibility = (state: DocumentVisibilityState) => {
    target.visibilityState = state;
    target.dispatchEvent(new Event('visibilitychange'));
  };
  return { target: target as VisibilityTarget, setVisibility };
}

let uninstall: () => void = () => undefined;

function setup() {
  const media = fakeMediaDevices();
  const doc = fakeDocument();
  uninstall = installBackgroundMicGuard({ target: doc.target, mediaDevices: media.mediaDevices });
  return { ...media, ...doc };
}

afterEach(() => {
  uninstall();
  uninstall = () => undefined;
});

describe('installBackgroundMicGuard', () => {
  it('hands getUserMedia results through unchanged', async () => {
    const { mediaDevices, getUserMedia } = setup();
    const stream = await mediaDevices.getUserMedia({ audio: true });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stream).toBe(await getUserMedia.mock.results[0].value);
  });

  it('passes getUserMedia failures (e.g. permission denied) through', async () => {
    const { mediaDevices, getUserMedia } = setup();
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    await expect(mediaDevices.getUserMedia({ audio: true })).rejects.toMatchObject({
      name: 'NotAllowedError',
    });
  });

  it('ends live microphone tracks when the app is hidden: `ended` first, then stop()', async () => {
    const { mediaDevices, tracks, setVisibility } = setup();
    await mediaDevices.getUserMedia({ audio: true });
    const [track] = tracks;
    const seen: string[] = [];
    track.addEventListener('ended', () => seen.push(`ended while ${track.readyState}`));

    setVisibility('hidden');

    expect(seen).toEqual(['ended while live']);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(track.readyState).toBe('ended');
  });

  it('ends live microphone tracks when Capacitor pauses the app', async () => {
    const { mediaDevices, tracks, target } = setup();
    await mediaDevices.getUserMedia({ audio: true });

    target.dispatchEvent(new Event('pause'));

    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
  });

  it('leaves tracks alone while the app stays visible', async () => {
    const { mediaDevices, tracks, setVisibility } = setup();
    await mediaDevices.getUserMedia({ audio: true });

    setVisibility('visible');

    expect(tracks[0].stop).not.toHaveBeenCalled();
    expect(tracks[0].readyState).toBe('live');
  });

  it('skips tracks the app has already stopped', async () => {
    const { mediaDevices, tracks, setVisibility } = setup();
    await mediaDevices.getUserMedia({ audio: true });
    const [track] = tracks;
    const ended = vi.fn();
    track.addEventListener('ended', ended);
    track.stop(); // the recording was stopped normally

    setVisibility('hidden');

    expect(ended).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('uninstalling restores getUserMedia and stops listening', async () => {
    const { mediaDevices, getUserMedia, tracks, setVisibility } = setup();
    await mediaDevices.getUserMedia({ audio: true });

    uninstall();
    setVisibility('hidden');

    expect(mediaDevices.getUserMedia).toBe(getUserMedia);
    expect(tracks[0].stop).not.toHaveBeenCalled();
  });

  it('does nothing where there is no getUserMedia (jsdom, old WebViews)', () => {
    const { target } = fakeDocument();
    expect(() => {
      uninstall = installBackgroundMicGuard({ target });
    }).not.toThrow();
  });
});
```

第三個測試鎖住順序：`ended` 必須在 track 仍是 `live` 時送出。M3b 的 `SegmentRecorder` 收到 `ended` 會**同步**呼叫 `onInterrupted()` 並停掉當段 `MediaRecorder`，之後才釋放麥克風，最後一段的資料才完整。

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/web -- src/platform/backgroundMicGuard.test.ts`
Expected: FAIL，`Error: Failed to resolve import "./backgroundMicGuard" from "src/platform/backgroundMicGuard.test.ts". Does the file exist?`

- [ ] **Step 3: 實作**

`apps/web/src/platform/backgroundMicGuard.ts`：

```ts
/** The document, or a stand-in in tests. */
export interface VisibilityTarget extends EventTarget {
  readonly visibilityState: DocumentVisibilityState;
}

export interface BackgroundMicGuardOptions {
  /** Defaults to `document`. */
  target?: VisibilityTarget;
  /** Defaults to `navigator.mediaDevices`. */
  mediaDevices?: MediaDevices;
}

/**
 * Android keeps a backgrounded app's microphone track "live" but feeds it silence, so M3b's
 * SegmentRecorder would keep uploading silent segments and never report an interruption. In the
 * Capacitor app, end every live microphone track as soon as the app is paused or hidden: the
 * `ended` event makes SegmentRecorder hand over what was recorded, and useRecorder shows
 * 「錄音已中斷，已錄的部分會照常轉寫」 once the app is in front again.
 *
 * Returns a function that removes the guard.
 */
export function installBackgroundMicGuard(options: BackgroundMicGuardOptions = {}): () => void {
  const target: VisibilityTarget = options.target ?? document;
  const mediaDevices = options.mediaDevices ?? globalThis.navigator?.mediaDevices;
  if (!mediaDevices?.getUserMedia) return () => undefined;

  const original = mediaDevices.getUserMedia;
  const tracks = new Set<MediaStreamTrack>();

  mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    const stream = await original.call(mediaDevices, constraints);
    for (const track of stream.getAudioTracks()) tracks.add(track);
    return stream;
  };

  const endTracks = () => {
    for (const track of tracks) {
      if (track.readyState !== 'live') continue;
      // stop() never fires `ended`. Fire it first, while the track still delivers audio, so the
      // recorder stops its MediaRecorder with everything recorded so far; then free the mic.
      track.dispatchEvent(new Event('ended'));
      track.stop();
    }
    tracks.clear();
  };

  const onVisibilityChange = () => {
    if (target.visibilityState === 'hidden') endTracks();
  };

  target.addEventListener('visibilitychange', onVisibilityChange);
  // Capacitor fires `pause` on document when the Android activity is paused.
  target.addEventListener('pause', endTracks);

  return () => {
    target.removeEventListener('visibilitychange', onVisibilityChange);
    target.removeEventListener('pause', endTracks);
    mediaDevices.getUserMedia = original;
    tracks.clear();
  };
}
```

說明：
- 同時聽 `visibilitychange` 與 Capacitor 的 `pause`：`pause` 在 activity `onPause` 時一定會送出（已讀過 Capacitor 8.5.3 的 `MockCordovaWebViewImpl.handlePause`），`visibilitychange` 則是標準事件，兩者任一先到都會結束錄音，後到的那個找不到 `live` track 就不做事。
- 第一次按「錄製」時的系統權限對話框也會讓 activity `onPause`，但那時 `getUserMedia` 還沒回來、沒有任何 track，不受影響。
- 以實例屬性覆寫 `getUserMedia` 是常見的包裝方式；`original.call(mediaDevices, …)` 保留原本的 `this`。

- [ ] **Step 4: 執行測試與型別檢查，確認通過**

Run: `npm test -w @oc/web -- src/platform/backgroundMicGuard.test.ts && npm run typecheck -w @oc/web`
Expected: `Tests  8 passed (8)`；`tsc --noEmit` 無錯誤輸出。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/platform/backgroundMicGuard.ts apps/web/src/platform/backgroundMicGuard.test.ts
git commit -m "feat(web): end the microphone when the Android app goes to the background"
```

- [ ] **Step 6: 把背景守衛寫回共用契約並回報**

總覽是有約束力的契約：spec §5 規定「錄音不需轉接層」，契約 §4「Web 入口與平台選擇」也只列 `desktopFileSaver.ts`、`capacitorFileSaver.ts`、`global.d.ts`。`backgroundMicGuard.ts` 在 `selectPlatform` 的 Capacitor 分支包住 `navigator.mediaDevices.getUserMedia`，實質上是錄音的轉接層，所以要同步寫進契約，之後的計畫（例如 iOS）與審閱者才不會讀到互相矛盾的規定。

在 `docs/superpowers/plans/2026-10-21-00-overview.md` 的 §4「Web 入口與平台選擇 `apps/web/src`」中，把這一整行：

```markdown
- `platform/selectPlatform.ts`：M1 只回傳網頁平台（IndexedDB + browserFileSaver + `canPrint: true`）；M4 加入 `window.ocDesktop` 分支；M5 加入 `Capacitor.isNativePlatform()` 分支（`canPrint: false`）。
```

換成：

```markdown
- `platform/selectPlatform.ts`：M1 只回傳網頁平台（IndexedDB + browserFileSaver + `canPrint: true`）；M4 加入 `window.ocDesktop` 分支；M5 加入 `Capacitor.isNativePlatform()` 分支（`canPrint: false`，並呼叫 `installBackgroundMicGuard()`）。
```

再把緊接在下面的這一整行：

```markdown
- `platform/desktopFileSaver.ts`（M4）、`platform/capacitorFileSaver.ts`（M5）、`global.d.ts`（M4 宣告 `window.ocDesktop?: { saveFile(filename: string, bytes: Uint8Array): Promise<boolean> }`）。
```

換成：

```markdown
- `platform/desktopFileSaver.ts`（M4）、`platform/capacitorFileSaver.ts`（M5）、`global.d.ts`（M4 宣告 `window.ocDesktop?: { saveFile(filename: string, bytes: Uint8Array): Promise<boolean> }`）、`platform/backgroundMicGuard.ts`（M5：`installBackgroundMicGuard({ target?, mediaDevices? }): () => void`，App 暫停／隱藏時結束麥克風 track；spec §5「錄音不需轉接層」的唯一例外，用於 spec §8 背景中斷）。
```

Run: `grep -c "installBackgroundMicGuard" docs/superpowers/plans/2026-10-21-00-overview.md && grep -c "platform/backgroundMicGuard.ts" docs/superpowers/plans/2026-10-21-00-overview.md`
Expected: 第一個 grep 輸出 `2`（`selectPlatform.ts` 那行與檔案清單那行各一次），第二個輸出 `1`。

```bash
git add docs/superpowers/plans/2026-10-21-00-overview.md
git commit -m "docs: record M5 background mic guard in the contract"
```

回報：契約規定子計畫與總覽衝突時「以本檔為準並回報」，因此完成本 Task 時要明確告訴使用者「已修改共用契約 §4『Web 入口與平台選擇』：新增 `platform/backgroundMicGuard.ts`，`selectPlatform` 的 Capacitor 分支會呼叫 `installBackgroundMicGuard()`。這是 spec §5『錄音不需轉接層』的例外，原因是 Android 對背景 App 的麥克風只送靜音、不結束 track，不包裝就無法做到 spec §8『回前景時提示錄音已中斷』，還會持續上傳靜音片段」。

---

### Task 8: `selectPlatform` 加入 Capacitor 分支

**Files:**
- Modify: `apps/web/src/platform/selectPlatform.ts`
- Modify: `apps/web/src/platform/selectPlatform.test.ts`

- [ ] **Step 1: 改寫測試（先失敗）**

整個檔案換成下列內容。前三個測試是 M4 原有的測試（一字不改）；新增「Android App 內改用分享選單並隱藏 PDF」、「Android App 內切到背景會結束麥克風」、「瀏覽器與 Electron 不包裝 `getUserMedia`」。`@capacitor/core` 以 `vi.mock` 取代，預設回報非原生，需要原生的測試用 `mockReturnValueOnce(true)`（`selectPlatform` 只呼叫一次）。

`apps/web/src/platform/selectPlatform.test.ts`：

```ts
import type { WriteFileOptions } from '@capacitor/filesystem';
import type { ShareOptions } from '@capacitor/share';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectPlatform } from './selectPlatform';

// Outside the Android app Capacitor reports a web platform; tests opt in per call.
const { isNativePlatform, writeFile, share } = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  writeFile: vi.fn(async (_options: WriteFileOptions) => ({ uri: 'file:///cache/exports/筆記.md' })),
  share: vi.fn(async (_options: ShareOptions) => ({})),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform } }));
vi.mock('@capacitor/filesystem', () => ({ Directory: { Cache: 'CACHE' }, Filesystem: { writeFile } }));
vi.mock('@capacitor/share', () => ({ Share: { share } }));

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

/** jsdom has no navigator.mediaDevices; install one that hands out a single fake mic track. */
function installFakeMicrophone() {
  const track = Object.assign(new EventTarget(), {
    kind: 'audio',
    readyState: 'live' as MediaStreamTrackState,
    stop: vi.fn(() => {
      track.readyState = 'ended';
    }),
  });
  const getUserMedia = vi.fn(
    async (_constraints?: MediaStreamConstraints) =>
      ({ getTracks: () => [track], getAudioTracks: () => [track] }) as unknown as MediaStream,
  );
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  return { track, getUserMedia };
}

afterEach(() => {
  delete window.ocDesktop;
  Reflect.deleteProperty(navigator, 'mediaDevices');
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  // Back to the vi.fn() implementations above, dropping unused mockReturnValueOnce values.
  isNativePlatform.mockReset();
  writeFile.mockReset();
  share.mockReset();
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

  it('shares exports and hides PDF inside the Android app', async () => {
    isNativePlatform.mockReturnValueOnce(true);
    const platform = await selectPlatform();

    expect(platform.canPrint).toBe(false);
    await platform.fileSaver.save('筆記.md', new Blob(['# 筆記'], { type: 'text/markdown' }));

    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'exports/筆記.md', directory: 'CACHE' }),
    );
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ files: ['file:///cache/exports/筆記.md'] }),
    );
  });

  it('inside the Android app, ends the microphone when the app goes to the background', async () => {
    const mic = installFakeMicrophone();
    isNativePlatform.mockReturnValueOnce(true);
    await selectPlatform();

    await navigator.mediaDevices.getUserMedia({ audio: true });
    document.dispatchEvent(new Event('pause'));

    expect(mic.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(mic.track.stop).toHaveBeenCalledTimes(1);
  });

  it('leaves getUserMedia alone in browsers and Electron', async () => {
    const mic = installFakeMicrophone();
    await selectPlatform();
    expect(navigator.mediaDevices.getUserMedia).toBe(mic.getUserMedia);
  });
});
```

第五個測試在真正的 `document` 上送出 `pause`（Capacitor 在 Android 送出的就是這個事件），驗證 `selectPlatform` 有把守衛接上預設的 `document` 與 `navigator.mediaDevices`。

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npm test -w @oc/web -- src/platform/selectPlatform.test.ts`
Expected: FAIL，`Tests  2 failed | 4 passed (6)`：
- `shares exports and hides PDF inside the Android app` → `AssertionError: expected true to be false // Object.is equality`
- `inside the Android app, ends the microphone when the app goes to the background` → `AssertionError: expected "spy" to be called 1 times, but got 0 times`

- [ ] **Step 3: 實作**

整個檔案換成：

`apps/web/src/platform/selectPlatform.ts`：

```ts
import { Capacitor } from '@capacitor/core';
import {
  createBrowserFileSaver,
  createIndexedDbStorage,
  openAppDb,
  type FileSaver,
  type Platform,
} from '@oc/core';
import { installBackgroundMicGuard } from './backgroundMicGuard';
import { createCapacitorFileSaver } from './capacitorFileSaver';
import { createDesktopFileSaver } from './desktopFileSaver';

/** Web, Electron (M4) and the Capacitor Android app (M5). */
export async function selectPlatform(): Promise<Platform> {
  const db = await openAppDb();
  const isCapacitorApp = Capacitor.isNativePlatform();
  // Android silences a backgrounded app's microphone; end the recording there instead.
  if (isCapacitorApp) installBackgroundMicGuard();
  return {
    storage: createIndexedDbStorage(db),
    fileSaver: selectFileSaver(isCapacitorApp),
    // Android's WebView has no window.print(), so the app hides 匯出 PDF.
    canPrint: !isCapacitorApp,
  };
}

function selectFileSaver(isCapacitorApp: boolean): FileSaver {
  if (isCapacitorApp) return createCapacitorFileSaver();
  // apps/desktop's preload script exposes window.ocDesktop; browsers do not have it.
  const desktop = window.ocDesktop;
  return desktop ? createDesktopFileSaver(desktop) : createBrowserFileSaver();
}
```

`main.tsx` 不必修改：它本來就是 `await selectPlatform()` 後才渲染，守衛在第一次錄音之前就已安裝。儲存仍是 IndexedDB（契約：三端皆 IndexedDB）。

- [ ] **Step 4: 執行全部 web 測試、亂序重跑與型別檢查**

Run: `npm test -w @oc/web && npm run typecheck -w @oc/web`
Expected: `Test Files  8 passed (8)`、`Tests  31 passed (31)`；`tsc --noEmit` 無錯誤輸出。

Run: `npm test -w @oc/web -- --sequence.shuffle --sequence.seed=7`
Expected: `Tests  31 passed (31)`（測試之間沒有殘留狀態）。

- [ ] **Step 5: 建置並同步到 Android 專案**

Run: `npm run build -w @oc/web`
Expected: `✓ built in`，沒有 `Some chunks are larger than 1000 kB` 警告；`dist/assets/index-*.js` 比 M4 大約 10 kB（`@capacitor/core`），另外多出幾個 1–10 kB 的小分塊（例如 `web-*.js`、`definitions-*.js`：Capacitor 外掛在瀏覽器中的實作，只有呼叫時才載入）。

Run: `npm run cap:sync -w @oc/web`
Expected: 再 build 一次後輸出 `√ Copying web assets from dist to android\app\src\main\assets\public`、`[info] Found 2 Capacitor plugins for android:`、`[info] Sync finished in …s`（不需要 JDK）。

Run: `git status --short -- . ':(exclude)docs/superpowers/plans'`
Expected: 只有 ` M apps/web/src/platform/selectPlatform.test.ts` 與 ` M apps/web/src/platform/selectPlatform.ts`（sync 寫入的檔案都被忽略，`capacitor.settings.gradle`、`app/capacitor.build.gradle` 內容不變）。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/platform/selectPlatform.ts apps/web/src/platform/selectPlatform.test.ts
git commit -m "feat(web): select the Capacitor platform inside the Android app"
```

---

### Task 9: 手機版面端對端測試（抽屜）

**Files:**
- Test: `apps/web/e2e/mobile.spec.ts`

本 Task 驗證 M1–M3b 已完成的窄螢幕版面在 Android 手機的尺寸與觸控下仍正確（另加 Task 5 的 viewport 變更）。它不改任何程式，所以測試預期**第一次就通過**；若失敗，代表手機版面本身有問題，停下來回報，不要在本計畫內修改 `packages/core` 的樣式。

- [ ] **Step 1: 寫測試**

`devices['Pixel 7']` 是 412×839 CSS px、`isMobile`、`hasTouch`、Android Chrome 的 user agent。拿掉 `defaultBrowserType`：在檔案層級 `test.use` 它會要求另開 worker，而本專案本來就只跑 Chromium。背景以 `tap` 的 `position` 點在抽屜（最寬 300px）右側。

`apps/web/e2e/mobile.spec.ts`：

```ts
import { devices, expect, test } from '@playwright/test';

// A typical Android phone: 412 CSS px wide, touch input, Android Chrome user agent.
// defaultBrowserType is left out: it would force a new worker, and this project is Chromium anyway.
const { defaultBrowserType: _browserType, ...pixel7 } = devices['Pixel 7'];
test.use(pixel7);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: '標題' })).toBeVisible();
});

test('手機尺寸：點選單鈕打開筆記清單抽屜，點背景關閉', async ({ page }) => {
  const list = page.getByRole('list', { name: '筆記清單' });
  await expect(list).toBeHidden();

  await page.getByRole('button', { name: '開啟筆記清單' }).tap();
  await expect(list).toBeVisible();

  // The drawer is at most 300px wide; the backdrop covers the rest of the screen.
  await page.locator('.oc-backdrop').tap({ position: { x: 380, y: 450 } });
  await expect(list).toBeHidden();
  await expect(page.getByRole('button', { name: '開啟筆記清單' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('手機尺寸：畫面不會左右捲動，錄製、設定、匯出都在畫面內', async ({ page }) => {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

  for (const control of [
    page.locator('.oc-record-btn'),
    page.getByRole('button', { name: '設定', exact: true }),
    page.getByRole('button', { name: '匯出', exact: true }),
  ]) {
    await expect(control).toBeVisible();
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
});
```

`設定` 與 `匯出` 必須 `exact: true`：沒有設定後端時錄製鈕的文字是「請先設定」，預設的子字串比對會同時找到兩顆鈕而違反 strict mode。錄製鈕以 M3b 的 class `oc-record-btn` 定位，與它當下的文字無關。

- [ ] **Step 2: 執行，確認通過**

Run: `npm run e2e -w @oc/web -- e2e/mobile.spec.ts`
Expected: `2 passed`

- [ ] **Step 3: 執行全部網頁版端對端測試**

Run: `npm run e2e -w @oc/web`
Expected: `13 passed`（M4 結束時的 11 個 + 本 Task 的 2 個）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/mobile.spec.ts
git commit -m "test(web): cover the phone-sized layout on an emulated Android device"
```

---

### Task 10: 第一次建置並安裝到 Android 手機

**Files:** 無新增或修改（不 commit）。

- [ ] **Step 1: 再次檢查建置環境（停止條件）**

Run:

```bash
java -version 2>&1 | head -1
"$(cygpath -u "$JAVA_HOME")/bin/java" -version 2>&1 | head -1
ls "$(cygpath -u "$ANDROID_HOME")/licenses" "$(cygpath -u "$ANDROID_HOME")/platforms"
ls "$(cygpath -u "${CAPACITOR_ANDROID_STUDIO_PATH:-C:/Program Files/Android/Android Studio/bin/studio64.exe}")"
"$(cygpath -u "$ANDROID_HOME")/platform-tools/adb.exe" devices
SERIAL=$("$(cygpath -u "$ANDROID_HOME")/platform-tools/adb.exe" devices | tr -d '\r' | awk 'NR>1 && $2=="device" {print $1; exit}')
echo "SERIAL=$SERIAL"
npm exec -w @oc/web -- cap run android --list
```

Expected: 前兩行都是 `openjdk version "21.0.…" … LTS`；`licenses` 底下有 `android-sdk-license`、`platforms` 底下有 `android-36`；接著是 `/c/Program Files/Android/Android Studio/bin/studio64.exe`（或 `CAPACITOR_ANDROID_STUDIO_PATH` 指向的路徑）；然後是 `List of devices attached` 與一行 `<序號>	device`；`SERIAL=<序號>`（不是空的）；最後是 `cap run` 的目標表格（只列出、不建置）：

```
Name                             API      Target ID
-------------------------------------------------------------
<手機型號>                        API <版本>   <序號>
```

表格中必須有一列的 `Target ID` 等於 `SERIAL`。名稱後面帶 `(emulator)` 的列是已建立的模擬器 AVD（例如 `Medium Phone API 36 (emulator)`），出現也正常：這正是 Step 2 必須以 `--target` 指定手機的原因（目標超過一個時，`cap run` 會互動詢問 `Please choose a target device:`，代理的非互動 shell 無法回答）。

任何一項不符：**停止本計畫**，回到 Task 1 對應的步驟（`SERIAL=` 是空的 → Task 1 Step 6；`studio64.exe` 找不到 → Task 1 Step 5 的最後一個停止條件），請使用者處理後再從本步驟重來。

- [ ] **Step 2: 建置、安裝並啟動**

代理每次執行指令都是新的 shell，所以在同一段指令中重新取得序號，再以 `--target` 傳給 `cap run`（npm 把 `--` 之後的參數接在 script 最後，實際執行 `npm run build && cap run android --target <序號>`）。`test -n` 確保序號是空的時候不會執行 `cap run`（空的 `--target` 等於沒指定，又會詢問）。

Run:

```bash
SERIAL=$("$(cygpath -u "$ANDROID_HOME")/platform-tools/adb.exe" devices | tr -d '\r' | awk 'NR>1 && $2=="device" {print $1; exit}')
echo "SERIAL=$SERIAL"
test -n "$SERIAL" && npm run android:run -w @oc/web -- --target "$SERIAL"
```

Expected: 第一行 `SERIAL=<序號>`（不是空的）；接著是 `vite build`，然後 Capacitor 的 sync（`√ Copying web assets …`、`√ Updating Android plugins …`、`[info] Sync finished in …s`），然後：

```
√ Running Gradle build in …s
√ Deploying app-debug.apk to <序號> in …s
```

停止條件：`SERIAL=` 是空的（`cap run` 不會執行，指令以非 0 結束）→ 手機沒有以 `device` 狀態連線，回到 Task 1 Step 6。

第一次建置會下載 Gradle 8.14.3 與相依套件，需要 3–10 分鐘（Windows Defender 可能詢問是否允許 Java 存取網路，選允許）。完成後手機自動開啟 open-copilot，畫面有一篇空白筆記，標題框顯示「請輸入標題..」、內文顯示「在這裡開始編寫筆記..」。

常見失敗與對應（照做後重跑本步驟；仍失敗就停下來回報完整錯誤訊息）：
- `SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable` → `ANDROID_HOME` 沒傳到這個終端機（Task 1 Step 4，重開終端機）。
- `ERROR: JAVA_HOME is set to an invalid directory`、`JAVA_HOME is not set and no 'java' command could be found`、`invalid source release: 21`、`Unsupported class file major version` → JDK 不是 21 或 `JAVA_HOME` 錯誤（Task 1 Step 2、4）。
- `License for package … not accepted` → Android Studio → SDK Manager 安裝並接受該套件的授權（Task 1 Step 3）。
- `Invalid target ID: <序號>`（後面接 `Valid targets are:` 清單）→ 取得序號後手機斷線或狀態改變：重新插拔，`adb devices` 再確認一次（Task 1 Step 6）。
- 出現 `Please choose a target device:` 而停住 → 指令少了 `--target`（例如直接跑了 `npm run android:run -w @oc/web`）。`cap run` 的目標除了接上的手機，還包括**所有已建立的模擬器 AVD**（不論是否開著），超過一個就會詢問；按 Ctrl+C 結束（代理則終止該指令），改用上面的指令重跑。
- App 開啟後全白 → 手機的「Android System WebView」過舊（`main.tsx` 使用 top-level await，需要 Chromium 89 以上）：到 Play 商店更新 Android System WebView 後重開 App。

- [ ] **Step 3: 確認頂部沒有被狀態列蓋住**

在手機上目視：☰（若為直式）、「請先設定」、AI 鈕與齒輪都完整顯示在狀態列（時間、電量）**下方**；畫面最底部的內容沒有被手勢列／導覽列蓋住。若被蓋住，停下來回報手機型號、Android 版本與 Android System WebView 版本（設定 → 應用程式 → Android System WebView）。

- [ ] **Step 4（選用）：在 Android Studio 開啟專案**

需要看原生 Logcat 時才做。Run: `npm run cap:sync -w @oc/web && npm run android:open -w @oc/web`
Expected: Android Studio 開啟 `apps/web/android`，Gradle Sync 成功（Gradle JDK 須是 JDK 21，見 Task 1 Step 3）。Android Studio 產生的 `apps/web/android/.idea/` 已被根 `.gitignore` 忽略。

- [ ] **Step 5: 確認工作目錄乾淨**

Run: `git status --short -- . ':(exclude)docs/superpowers/plans'`
Expected: 沒有輸出（Gradle 輸出、`.gradle`、`local.properties`、複製進去的網頁都被忽略）。

---

### Task 11: Verification（整體驗證）

**Files:** 無新增或修改。

- [ ] **Step 1: 全部單元與元件測試**

Run: `npm test`
Expected:
- `@oc/core`：`Test Files  46 passed (46)`、`Tests  296 passed (296)`（本計畫未修改，以 M3b 計畫為準）
- `@oc/shared`：`Test Files  1 passed (1)`、`Tests  3 passed (3)`
- `@oc/api`（M3a）：`Test Files  9 passed (9)`、`Tests  49 passed (49)`（本計畫未修改）
- `@oc/desktop`：`Test Files  4 passed (4)`、`Tests  26 passed (26)`（本計畫未修改）
- `@oc/web`：`Test Files  8 passed (8)`、`Tests  31 passed (31)`

任何工作區都不應出現 `failed`；`@oc/web` 的輸出中不應出現 `stderr` 或 `Unhandled Errors`。

- [ ] **Step 2: 全部型別檢查**

Run: `npm run typecheck`
Expected: 每個 workspace 的 `tsc --noEmit` 皆無錯誤輸出（`@oc/web` 含 `capacitor.config.ts` 與 `e2e/mobile.spec.ts`）。

- [ ] **Step 3: 網頁版端對端測試（重複 3 次確認穩定）**

Run: `npm run e2e -w @oc/web -- --repeat-each=3`
Expected: `39 passed`（13 個測試 × 3）。

- [ ] **Step 4: 桌面版端對端測試（確認 Electron 不受 Capacitor 影響）**

Run: `npm run e2e -w @oc/desktop`
Expected: `10 passed`（與 M4 相同；Electron 中 `Capacitor.isNativePlatform()` 為 false，匯出仍走原生「另存新檔」，PDF 仍可用）。這會開出真正的 Electron 視窗並寫入系統剪貼簿，執行期間不要操作滑鼠鍵盤。

- [ ] **Step 5: 正式建置**

Run: `npm run build -w @oc/web && ! grep -q "viewport-fit" apps/web/dist/index.html && echo "no viewport-fit"`
Expected: `✓ built in`，沒有 `Some chunks are larger than 1000 kB` 警告；最後一行是 `no viewport-fit`，指令以 exit code 0 結束（`dist/index.html` 若仍含 `viewport-fit`，不會印出這行且 exit code 為 1）。

- [ ] **Step 6: 安裝最新版到手機**

與 Task 10 Step 2 相同，以 `--target` 指定手機（已建立的模擬器 AVD 也算 `cap run` 的目標，不指定就會互動詢問）：

Run:

```bash
SERIAL=$("$(cygpath -u "$ANDROID_HOME")/platform-tools/adb.exe" devices | tr -d '\r' | awk 'NR>1 && $2=="device" {print $1; exit}')
echo "SERIAL=$SERIAL"
test -n "$SERIAL" && npm run android:run -w @oc/web -- --target "$SERIAL"
```

Expected: `SERIAL=<序號>`（不是空的），最後是 `√ Deploying app-debug.apk to <序號>`，App 在手機上開啟（Task 10 已處理過環境問題）。停止條件：`SERIAL=` 是空的 → 回到 Task 1 Step 6 重新接上手機。

- [ ] **Step 7: 手動檢查表（Android 實機）**

準備：
- 一個以 **https** 提供的 M3a 後端網址與存取金鑰（依 `apps/api/README.md` 部署；`ALLOWED_ORIGINS` 須含 `https://localhost`，預設值已含）。若暫時沒有，後端網址可先填 `https://example.invalid`、金鑰任意：錄音、權限、背景中斷、匯出都能檢查（片段會在重試後變成「⚠ 第 N 段未轉寫・重試」），轉寫內容相關的項目標記為「未驗證」並回報。
- 檢查 WebView 用：電腦的 Chrome 開 `chrome://inspect/#devices`，App 的 `https://localhost/` 會出現在清單中（debug 版預設開啟 WebView 偵錯），按 inspect 可看 Console 與 Network。

啟動與版面：
- [ ] 手機桌面的 App 名稱為「open-copilot」（Capacitor 預設圖示）；開啟後自動有一篇空白筆記，「請輸入標題..」「在這裡開始編寫筆記..」都在。
- [ ] 頂部按鈕在狀態列下方、底部內容不被導覽列／手勢列蓋住（直式與橫式各看一次）。
- [ ] 直式：左側筆記清單收成抽屜；點 ☰ 開啟，點背景或選一篇筆記後收回；新增、切換筆記正常。橫式（寬度 ≥ 768dp 的手機或平板）清單常駐左側。
- [ ] 刪除筆記：跳出「確定要刪除「…」嗎？此動作無法復原。」，按「Cancel」不刪、按「OK」刪除（按鈕為 Capacitor 內建英文，已知限制）。
- [ ] 在標題與內文用中文輸入法（注音、拼音或手寫）輸入，選字正常；軟體鍵盤彈出時正在輸入的位置仍看得到。
- [ ] 從「最近使用的應用程式」把 open-copilot 滑掉再開啟：筆記與設定都還在。

設定：
- [ ] 按齒輪，後端網址填 https 網址、存取金鑰填好，按「測試連線」顯示「連線成功」（chrome://inspect 的 Network 中 `/health` 的 Request Headers 有 `Origin: https://localhost`），按「儲存」後錄製鈕變成「錄製」。

麥克風權限：
- [ ] （第一次安裝）在內文中間點一下，按「錄製」：跳出 Android 系統權限對話框「要允許 open-copilot 錄音嗎？」（選項依 Android 版本略有不同）。選「不允許」：App 顯示「無法使用麥克風，請在系統或瀏覽器設定中允許麥克風權限」，沒有開始錄音，按「關閉訊息」可關掉。
- [ ] 再按一次「錄製」：若再次跳出對話框，選「使用應用程式時」；若沒有跳出（系統已記住拒絕），到 設定 → 應用程式 → open-copilot → 權限 → 麥克風 → 選「僅在使用應用程式時允許」，回 App 再按「錄製」。開始錄音：按鈕變成紅色「停止」，筆記清單（新增、切換、刪除）無法操作。

錄音 1 分鐘：
- [ ] 用中文連續說話 **1 分鐘**（自然停頓）：每 4–8 秒在游標處插入一段繁體中文，順序與說話順序一致；途中在內文其他位置打字，轉寫文字仍接在原插入點。
- [ ] 按「停止」：短暫顯示「處理中」，最後一段插入後回到「錄製」，筆記清單恢復可用。chrome://inspect 的 Network 中每段 `/transcribe` 的 Payload 是 `segment-N.webm`（`audio/webm`），大小遠小於 5 MB。

背景中斷：
- [ ] 開始錄音，說幾句話後按 Home 鍵回到桌面，等 10 秒再回到 App：顯示「錄音已中斷，已錄的部分會照常轉寫」；切到背景**之前**說的話照常插入；錄製鈕已回到「錄製」；背景那 10 秒沒有插入任何文字。
- [ ] 開始錄音後按電源鍵關閉螢幕，5 秒後解鎖回到 App：同樣顯示中斷提示，已錄部分照常插入。
- [ ] 中斷後按「關閉訊息」，再按「錄製」：可以正常開始新的錄音。

匯出（系統分享選單）：
- [ ] 建立標題「週會紀錄」的筆記，內文含標題 1、粗體、紅字、項目清單。按「匯出」：選單只有「Markdown」「Word」「純文字」三項，**沒有 PDF**。
- [ ] 匯出 → Markdown：跳出 Android 分享選單（標題「分享匯出的筆記」），選「雲端硬碟」（或 Gmail）：檔名為「週會紀錄.md」，開啟後內容正確；回到 App 後狀態列顯示「已匯出 Markdown」。
- [ ] 匯出 → Word：檔名「週會紀錄.docx」，以 Google 文件或 Word App 開啟，標題、粗體、紅字、清單皆保留；顯示「已匯出 Word」。
- [ ] 匯出 → 純文字：檔名「週會紀錄.txt」，開啟後中文無亂碼，第一行標題、空一行、內文；顯示「已匯出純文字」。
- [ ] 打開分享選單後按返回鍵（或點選單外面）關閉：不產生任何分享，狀態列**不顯示**任何訊息（沒有「匯出失敗，請再試一次」）。

其他：
- [ ] 按「複製」：狀態列顯示「已複製全文」；到 Keep 或任一可輸入文字的 App 貼上，內容為整篇筆記。
- [ ] 按手機返回鍵：直接離開 App（已知限制，記錄即可）；再開啟時筆記都在。
- [ ] chrome://inspect 的 Console 沒有錯誤或警告（使用 `https://example.invalid` 時，預期會有連線錯誤）。

把每一項的結果（通過／失敗／未驗證）與手機型號、Android 版本、Android System WebView 版本一起回報。

- [ ] **Step 8: 確認工作目錄乾淨**

Run: `git status --short -- . ':(exclude)docs/superpowers/plans'`
Expected: 沒有輸出（`dist/`、`apps/web/android` 的 build 輸出與複製進去的網頁、`.idea/`、`test-results/` 皆被忽略；計畫檔因勾選 checkbox 而變動是允許的，故排除）。
