# open-copilot v1 追加項目 — 設計

- 日期：2026-10-22
- 狀態：已定案。2026-10-22 使用者授權由 Claude 挑選與決定，不需要逐段確認
- 前提：v1 主體（M1–M5，見 `2026-10-21-voice-notes-design.md` 與 `plans/2026-10-21-00-overview.md`）已經完成
- 目標：交付一個**可以實際操作的原型**，並補上品質（CI）、資料安全（備份）、手機可用性（PWA）、錄音回饋、AI 摘要／待辦事項

## 0. 執行順序

| 順序 | 里程碑 | 內容 | 為什麼排在這裡 |
|---|---|---|---|
| 1 | M6 | Groq 轉寫、一鍵啟動原型、真實語音端對端測試 | 完成後原型才能真正使用 |
| 2 | M7 | GitHub Actions CI | 先建好防護，後面每個里程碑都由 CI 把關 |
| 3 | M8 | 筆記備份匯出／匯入 | 筆記只存在瀏覽器裡，資料遺失風險最大 |
| 4 | M9 | PWA 與手機分享網址 | 不必等 Android 工具鏈，手機也能使用 |
| 5 | M10 | 錄音計時器、音量條、轉寫中提示 | 小改動，可以立刻改善錄音體驗 |
| 6 | M11 | AI 摘要與待辦事項 | 範圍最大，而且依賴 M6 的 Groq 串接 |

每個里程碑都遵循 v1 的做法：實作計畫 → TDD → 逐任務兩階段審查 → 里程碑審查 → 全套驗證 → 推送。

## 1. M6：Groq 轉寫與可操作原型

### 1.1 轉寫服務
- `apps/api` 加入 `TRANSCRIBE_PROVIDER`，可選 `groq` 或 `openai`。
  - **未設定時**：有 `GROQ_API_KEY` 就用 `groq`；否則有 `OPENAI_API_KEY` 就用 `openai`；兩者都沒有則啟動失敗，並印出明確的錯誤訊息。
  - **Groq**：使用 `openai` SDK，`baseURL: https://api.groq.com/openai/v1`；模型 `whisper-large-v3-turbo`，可用 `GROQ_TRANSCRIBE_MODEL` 覆寫；`language: 'zh'`。
  - **OpenAI**：沿用 v1 的 `gpt-4o-mini-transcribe`。
- `config.ts` 的 `openaiApiKey` 改成 `{ provider, apiKey, model }`。`Transcriber` 介面維持不變。
- **prompt 長度上限**：Whisper 系列的 prompt 上限是 224 tokens，所以後端要截斷 prompt，只保留**最後 60 個字**（加上固定前綴；Whisper 用 byte-level BPE，token 數不超過 UTF-8 位元組數，所以整個 prompt 另以 224 個 UTF-8 位元組為上限：前綴 13 字加 60 個一般繁體字是 219 位元組；emoji、CJK 擴充 B 等每字 4 位元組的字會讓尾段少於 60 字）。前端照樣送最後 200 字，由後端負責截斷，前端不用改。
- **上游 429**：Groq 回 429 時，後端改回 429 `rate_limited`，並轉傳上游的 `Retry-After`（無條件進位成整數秒並限制在 1–300 秒；沒有或看不懂就帶 `10`）。v1 原本把它當 502，現在讓前端照 429 的規則等待後重送。
- `.env.example` 和 README 加上 `GROQ_API_KEY`、`TRANSCRIBE_PROVIDER`、`GROQ_TRANSCRIBE_MODEL`。

### 1.2 切段長度
- `SegmentPolicy` 預設值改為 `minMs 8000`、`maxMs 12000`。停頓門檻（`silenceMs 300`、`threshold 0.01`）不變。
- 原因：Groq 每次請求最少按 10 秒計費。免費額度是每分鐘 20 次、每小時 7,200 音訊秒、每天 28,800 音訊秒、每天 2,000 次請求。切成 8–12 秒時，一小時大約 6,000 計費秒，不會超過上限；每天約可錄 4–5 小時。
- 契約 §4 的 `SegmentPolicy` 預設值跟著更新。

### 1.2a Windows 內建離線轉寫（`windows` provider，2026-10-22 追加）
- 使用者決定：沒有雲端 key 時，先用 Windows 內建的語音辨識，日後再換成 Groq。
- 已實測可行：本機有 `System.Speech` 的 zh-TW 辨識器（`MS-1028-80-DESK`）。用繁中 TTS 合成句子再辨識，大部分字正確，但不會加標點（例：「請小明」辨識成「井小民」）。
- `TRANSCRIBE_PROVIDER` 新增 `windows`。**未設定時的選擇順序**：有 `GROQ_API_KEY` 用 `groq`；否則有 `OPENAI_API_KEY` 用 `openai`；否則在 Windows（`process.platform === 'win32'`）上用 `windows`；以上都不符合就啟動失敗並說明原因。
- 實作 `apps/api/src/transcriber/windowsTranscriber.ts`：
  1. 上傳的音訊寫進暫存檔，再用 `ffmpeg -i <in> -ar 16000 -ac 1 -f wav <out.wav>` 轉檔。ffmpeg 路徑取 `FFMPEG_PATH`，沒設定就用 PATH 上的 `ffmpeg`。
  2. 用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File apps/api/scripts/windows-stt.ps1 -Wav <out.wav>` 辨識。這支腳本必須存成 **UTF-8 with BOM**，否則 Windows PowerShell 5 會讀錯中文。腳本用 `SpeechRecognitionEngine(zh-TW)` 搭配 `DictationGrammar` 和 `SetInputToWaveFile`，迴圈呼叫 `Recognize()`，回傳 null **或丟出例外**都視為結束，避免無窮迴圈。最後把結果以 UTF-8 JSON `{ "text": "..." }` 輸出到 stdout。
  3. 單次辨識逾時 30 秒（從請求進來起算，排隊時間也算，與前端的請求逾時一致），最多同時處理 2 段，多的排隊。暫存檔一律在 `finally` 刪除。
  4. 忽略 `prompt`。輸出照樣經過 `toTraditional`。
- 錯誤處理：ffmpeg 或 PowerShell 失敗、逾時都丟錯，由後端對應成 502 `upstream_error`。
- 啟動檢查：provider 是 `windows`，但不在 Windows 上或找不到 ffmpeg 時，立即失敗並給出明確訊息。Docker（Linux）映像不支援這個 provider，README 要寫明。
- 測試：
  - 單元測試注入假的 process runner，涵蓋成功、逾時、非零結束碼、併發上限。
  - 整合測試 `windowsTranscriber.integration.test.ts`：在 win32 上用 TTS 產生 WAV 後實際辨識，檢查是否出現關鍵詞；非 Windows 則 skip。
- 契約變更：`TRANSCRIBE_PROVIDER` 多一個 `windows` 選項。

### 1.3 一鍵啟動原型
- 根目錄加入 `npm run prototype`，對應 `scripts/prototype.mjs`：
  1. 檢查轉寫來源：有 Groq 或 OpenAI 金鑰就用雲端；都沒有時，在 Windows 上自動改用 `windows` provider，並印出提示「目前使用 Windows 內建離線辨識，設定 GROQ_API_KEY 可提高準確度」。只有在連 `windows` 也不能用時，才印出申請 Groq key 的步驟並以 exit code 1 結束。
  2. `ACCESS_KEYS` 沒設定時，產生一把隨機存取金鑰，寫到 `apps/api/.env.local`（已列入 `.gitignore`），之後重複使用。
  3. 同時啟動後端（8787）和網頁 dev server（5173）。任何一個結束，另一個也跟著停止；按 Ctrl+C 會乾淨地收掉兩個。
  4. 自動開啟瀏覽器，網址是 `http://localhost:5173/#oc-setup=<base64url(JSON)>`，裡面帶 `apiBaseUrl` 和 `accessKey`。
- **網頁端**：啟動時如果 URL hash 裡有 `oc-setup`，就驗證格式並存進設定，然後用 `history.replaceState` 立刻把 hash 從網址列移除。格式不合法就忽略並保留原設定，不會報錯。
- **Vite proxy**：dev server 把 `/api/*` 轉到 `http://localhost:8787/*`。原型模式的 `apiBaseUrl` 用同源的 `http://localhost:5173/api`，網頁版因此不會遇到 CORS 問題；分享網址（M9）也沿用這個設定。
- **桌面版**：要搭配 `npm run prototype` 啟動的後端使用。設定頁的後端網址填 `http://localhost:8787`，CORS 預設已允許 `app://bundle`。README 寫清楚這個步驟。

### 1.4 真實語音端對端測試
- `apps/web/e2e-real/transcribe.real.spec.ts` 和獨立的 `playwright.real.config.ts`，**不**放進預設的 `npm run e2e`。
- 測試流程：
  1. 用 PowerShell 的 `System.Speech` 和繁中語音（`Microsoft Hanhan`；找不到就用任一個 `zh-TW` 語音）合成一段約 20 秒的固定中文句子，輸出成 WAV，放在暫存目錄。
  2. Chromium 帶 `--use-fake-ui-for-media-stream`、`--use-fake-device-for-media-stream`、`--use-file-for-fake-audio-capture=<wav>` 啟動。
  3. 啟動真的後端，用 `#oc-setup` 填好設定，按「錄製」，約 25 秒後按「停止」。後端走預設的 provider 選擇順序：有 Groq key 就真的打 Groq，否則用 `windows` 離線辨識。
  4. **判定**：編輯器裡至少出現 3 個預先指定關鍵詞中的 2 個（繁體）；不能出現簡體字樣本（例如「这」「们」）；而且沒有任何未轉寫標記。關鍵詞要挑 Windows 辨識器也能穩定辨識出來的詞（例如「會議」「測試」「版本」）。
- 這台機器沒有 key 時用 `windows` provider 跑，所以**一定要實際跑過並通過**。只有在非 Windows、而且沒有任何 key 的環境才 skip。（實作註：測試音訊要用 Windows 的 System.Speech 合成，所以非 Windows 一律 skip，即使有 key；見 M6-frontend 計畫的設計決策 9。）測試報告要寫明這次用的是哪個 provider。
- 執行指令：`npm run e2e:real -w @oc/web`。

## 2. M7：GitHub Actions CI

- `.github/workflows/ci.yml`，觸發條件：推送到任何分支，以及 pull request。
  （實作註記：pull request 只觸發「目標為 main」的 PR，因為分支推送已經跑過 CI，避免同一次推送跑兩次；見 M7 計畫設計決策 7。）
- **job `web-api`**（ubuntu-latest，Node 24）：
  1. `npm ci`
  2. `npm run typecheck`
  3. `npm test`
  4. `npm run build -w @oc/web`
  5. `npx playwright install --with-deps chromium`
  6. `npm run e2e`
  7. `docker build -f apps/api/Dockerfile .`
- **job `desktop`**（windows-latest，Node 24）：`npm ci` → 建置 web 和 desktop → 執行 Electron 端對端測試。不打包安裝檔。
- npm 快取使用 `actions/setup-node` 的 `cache: npm`。Electron 二進位只在 `desktop` job 下載；`web-api` job 設 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`。
- 失敗時上傳 Playwright 報告當 artifact，保留 7 天。
- **不在 CI 執行**：真實語音測試（需要金鑰）、Android 建置（需要 JDK 和 SDK）。
- **驗收**：推送後到 GitHub Actions 確認兩個 job 都是綠燈。

## 3. M8：筆記備份匯出／匯入

- **備份格式**：`open-copilot-backup-YYYYMMDD-HHmm.json`，內容為 `{ "app": "open-copilot", "version": 1, "exportedAt": <epoch ms>, "notes": Note[] }`。不包含未轉寫的音訊。
- **匯出**：透過 `platform.fileSaver.save`，三個平台共用同一條路徑。
- **匯入**：用 `<input type="file" accept="application/json,.json">` 選檔。
  - 驗證 `app`、`version` 和每篇 `Note` 的欄位型別；不合法就顯示「這不是 open-copilot 的備份檔」，不寫入任何資料。
  - **合併規則**：用 `id` 比對。本機沒有的直接新增；兩邊都有時保留 `updatedAt` 較新的版本。
  - 完成後顯示「已匯入 N 篇，略過 M 篇（本機版本較新）」。
- **介面**：NoteList 底部放「備份」和「匯入」兩個按鈕，錄音中停用。
- **提醒**：localStorage 的 `oc.lastBackupAt` 記錄上次備份時間。有筆記且超過 7 天沒有備份（或從來沒有備份過）時，Banner 改成顯示「已超過 7 天沒有備份筆記」和「立即備份」按鈕。備份成功後恢復原本的 Banner。
- 模組：`packages/core/src/backup/backupFormat.ts`（序列化與驗證）、`backup/mergeNotes.ts`（純函式）、`backup/useBackup.ts`、`components/BackupControls.tsx`。

## 4. M9：PWA 與手機分享網址

- 使用 `vite-plugin-pwa`（`generateSW`、`registerType: 'autoUpdate'`）。
  - manifest：名稱 `open-copilot`，`theme_color` 和 `background_color` 用主色，`display: standalone`，`lang: zh-TW`。
  - 圖示：192、512 和 maskable 512 三種尺寸，由 repo 內的 SVG 原稿在 build 前產生 PNG，並 commit 進 repo。
  - Service worker 只快取網頁本身的資源。`/api/*` 和任何跨網域請求都用 network-only，不快取。
- **只有網頁平台註冊 service worker**：`selectPlatform` 判定為網頁時才註冊；Electron（`app://`）和 Capacitor 都不註冊。
- **手機分享網址**：`npm run prototype -- --share` 會另外用 Cloudflare quick tunnel（`cloudflared tunnel --url http://localhost:5173`，不需要帳號）產生一個 HTTPS 網址，在終端機印出網址和 QR code，並在 `#oc-setup` 裡帶入 `apiBaseUrl = <tunnel>/api`。
  - `cloudflared` 以 npm devDependency 安裝（套件 `cloudflared`），不安裝成系統軟體。
  - Vite `server.allowedHosts` 加入 `.trycloudflare.com`。
  - 終端機警告：分享網址是公開的，請只在測試時開啟，用完按 Ctrl+C 關閉；後端仍然需要存取金鑰。
- **驗收**：
  1. Lighthouse 或 Playwright 檢查 manifest 和 service worker 都已註冊。
  2. 離線時重新整理仍然看得到筆記。
  3. 在 Playwright 的手機模擬環境用分享網址走一次完整流程。
  4. 真機安裝 PWA 列為手動檢查項目。

## 5. M10：錄音回饋

- 錄音時 ActionBar 顯示：
  - **計時器** `mm:ss`，從按下「錄製」開始計時。
  - **5 格音量條**：由 `SegmentRecorder` 新增的 `onLevel(rms)` 回呼驅動，大約每 100ms 更新一次，以 `aria-hidden` 隱藏，不影響輔助技術。
  - **「轉寫中 N 段」**：N 是已上傳但還沒插入的段數，N = 0 時不顯示。
- 超過 10 秒都沒有任何讀數高於門檻時，顯示一次「沒有偵測到聲音，請確認麥克風」，收到聲音後自動消失。
- 停止錄音後，計時器和音量條都消失。

## 6. M11：AI 摘要與待辦事項

- **後端**新增兩個端點，沿用存取金鑰驗證和限流：
  - `POST /ai/summary`：`{ title, text }` → `{ summary: string }`
  - `POST /ai/todos`：`{ title, text }` → `{ items: string[] }`
  - LLM 使用 Groq 的 OpenAI 相容 chat completions，模型由 `GROQ_LLM_MODEL` 設定，預設 `openai/gpt-oss-120b`。實作時先用 `GET /models` 確認模型存在，不存在就改用清單上可用的最大模型，並寫進 README。
  - 系統提示要求輸出繁體中文；`/ai/todos` 使用 JSON 輸出模式，回應經過 schema 驗證；兩個端點的輸出都再經過 `toTraditional`。
  - `text` 上限 60,000 字，超過回 413；空白內容回 400。上游錯誤的對應方式與 `/transcribe` 相同。
  - 沒有 Groq key 時，這兩個端點回 503 `{ error: 'ai_unavailable' }`。`ApiErrorCode` 加入 `ai_unavailable`。
- **前端**：
  - 「AI 摘要」和「待辦事項」兩顆按鈕解鎖，「AI 助理」和「AI 對話」維持上鎖。
  - **AI 摘要**：開啟側邊面板，顯示摘要，並提供「插入到筆記開頭」和「複製」。
  - **待辦事項**：開啟同一個面板，以勾選清單顯示，並提供「插入到筆記結尾」。插入的內容是 Tiptap 的 TaskList，放在標題「待辦事項」下面。
  - 錄音中、筆記內容為空、後端未設定時，這兩顆按鈕都停用，並用 `title` 說明原因。
- **TaskList**：使用 Tiptap v3 的 `TaskList` 和 `TaskItem`（`@tiptap/extension-list`）。匯出規則：Markdown 輸出 `- [ ]`／`- [x]`，純文字輸出 `☐`／`☑`，Word 用 `☐`／`☑` 字元開頭。
- **隱私**：第一次使用 AI 功能時跳出一次說明「筆記內容會送到 Groq 處理」，按「我知道了」後記錄在 localStorage，之後不再顯示。

## 7. 各里程碑都不能少的驗證

| 里程碑 | 自動驗證 | 只能由人做 |
|---|---|---|
| M6 | 單元測試；整合測試（mock Groq）；真實語音 e2e（有 key 時） | 真人對麥克風說話 |
| M7 | GitHub Actions 兩個 job 都是綠燈 | — |
| M8 | 單元測試（格式驗證、合併）；e2e：備份 → 清空資料 → 匯入 → 內容一致 | — |
| M9 | manifest 和 SW 檢查；離線重新整理；手機模擬環境走完流程 | 真機安裝 PWA |
| M10 | 元件測試（假時鐘、假音量）；e2e（假麥克風） | — |
| M11 | 後端測試（mock LLM）；前端元件測試；e2e（mock 後端）；有 key 時再打一次真實 API | 由人判斷摘要品質 |

## 8. 契約變更

1. `SegmentPolicy` 預設值改為 8000／12000。
2. `apps/api` 設定新增 `TRANSCRIBE_PROVIDER`（`groq`、`openai`、`windows`）、`GROQ_API_KEY`、`GROQ_TRANSCRIBE_MODEL`、`GROQ_LLM_MODEL`；`ApiErrorCode` 新增 `ai_unavailable`。`TRANSCRIBE_PROVIDER` 未設定時依序選擇：有 `GROQ_API_KEY` 用 `groq`，否則有 `OPENAI_API_KEY` 用 `openai`，否則在 Windows 上用 `windows`，都不符合就啟動失敗（見 1.2a）。
3. 上游 429 改為回 429，不再是 502。
4. 新增 `SegmentRecorder` 的 `onLevel` 回呼、`backup/*` 模組，以及 AI 端點的型別（`packages/shared/src/ai.ts`）。
5. M3a 實作時追加、已核准的行為（M6 改寫 `apps/api` 設定與轉寫服務時必須保留）：
   - `Transcriber.transcribe` 的輸入多一個選填欄位 `signal?: AbortSignal`：`app.ts` 在用戶端斷線時中止上游請求，每個轉寫服務實作（含 M6 的 Groq）都要把它轉給上游 SDK。
   - `loadConfig` 去除 `ACCESS_KEYS`、`ALLOWED_ORIGINS` 的重複項；`ALLOWED_ORIGINS` 每項必須是完整 origin（`scheme://host[:port]`，無路徑、無尾斜線），否則 throw；`ACCESS_KEYS` 任一項含空白就 throw。另匯出 `MIN_ACCESS_KEY_LENGTH`（16）與 `accessKeyWarning()`，短金鑰只警告不拒絕。
   - `apps/api/.env.example` 的 `ACCESS_KEYS` 刻意留空，直接複製後啟動會因缺金鑰而失敗，逼使用者自填長隨機金鑰（計畫 Task 10 原寫 `change-me-1,change-me-2`）。
   - `rateLimit` 找不到 `accessKey` 時 throw（經 `app.onError` 成 500），不退回 `anonymous` 桶；依契約的中介層順序不會發生。
   - 關機處理只處理第一個 SIGINT／SIGTERM，之後的訊號只記錄，不再呼叫 `server.close()`。
