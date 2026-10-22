# open-copilot 語音筆記 — 第一版設計

- 日期：2026-10-21
- 狀態：已確認，待審閱
- 範圍：富文本編輯器 + 錄音轉文字，三端（網頁／桌面／手機）共用程式碼

## 1. 目標與範圍

做一個類似截圖中「Proactor」的筆記應用：上方有「錄製」與 AI 功能鈕，下方是富文本編輯器。

**第一版要做**
- 富文本編輯：標題、內文、段落樣式、粗體／斜體／底線、字色、螢光筆、靠左／置中／靠右、項目清單、編號清單、復原／重做
- 筆記清單：新增、切換、刪除，依更新時間排序，自動存檔
- 錄音轉文字：按「錄製」即時把語音轉成文字插入筆記
- 複製全文、匯出 Markdown／Word／純文字／PDF
- 三端：網頁、Windows 桌面、Android（iOS 待有 Mac）

**第一版不做（YAGNI）**
- AI 摘要／待辦事項／AI 助理／AI 對話：按鈕顯示但上鎖、不可按（第二版接後端）
- 說話者辨識、保存原始音檔、整檔上傳轉寫
- 帳號系統、雲端同步筆記

## 2. 技術選型

| 項目 | 決定 |
|---|---|
| 前端 | React + Vite + TypeScript + Tiptap |
| 打包 | Capacitor（網頁＋iOS/Android）、Electron（桌面） |
| 後端 | Node + TypeScript + Hono |
| 語音轉文字 | 後端呼叫 OpenAI `gpt-4o-mini-transcribe` |
| 驗證 | 存取金鑰 + 後端限流 |
| 筆記儲存 | 本機 IndexedDB（`idb` 套件） |
| 測試 | Vitest、Testing Library、Playwright |

## 3. 專案結構（npm workspaces monorepo）

```
packages/
  shared/      Note 型別、API 請求／回應格式（前後端共用）
  core/        所有 React 元件、Tiptap、匯出、錄音、API client
apps/
  web/         Vite 網頁入口；同時是 Capacitor 的 iOS/Android 專案
  desktop/     Electron 殼，載入 web 的 build 輸出
  api/         Hono 後端
```

`core` 不得含平台判斷；平台差異只能出現在轉接層實作。

## 4. 前端元件

| 元件 | 職責 |
|---|---|
| `NoteList` | 左側清單：新增、切換、刪除、依 `updatedAt` 排序 |
| `ActionBar` | 「錄製」鈕 + 4 顆上鎖的 AI 鈕 |
| `Toolbar` | 復原／重做、段落樣式、粗斜底線、字色、螢光筆、對齊、清單、複製、匯出 |
| `TitleInput` | 標題輸入框，placeholder「請輸入標題..」 |
| `Editor` | Tiptap 內文，placeholder「在這裡開始編寫筆記..」 |
| `SettingsDialog` | 設定後端網址、存取金鑰，含「測試連線」（呼叫 `/health`） |
| `useRecorder` | 錄音、切段、上傳、重試、依序插入編輯器 |
| `noteStore` | 經 `Storage` 介面讀寫筆記；停止輸入 500ms 後自動存檔 |
| `exporters/` | `toMarkdown`、`toTxt`、`toDocx`（`docx` 套件）、`toPdf`（列印） |

### 匯出格式決定（M2 審查後確認，2026-10-22）

契約只規定各格式**至少**要保留的格式；以下是 M2 實作超出 M2 計畫決策表的部分，M3b、M4、M5 以此為準：

| 項目 | 決定 |
|---|---|
| 刪除線 | Word 保留刪除線；Markdown、純文字只留文字。 |
| 引言（`blockquote`） | Word 以縮排段落輸出，引言內的格式與清單照常保留；Markdown、純文字仍依「未知節點輸出文字內容」處理。 |
| 連結 | 只寫出 `http:`、`https:`、`mailto:`、`tel:` 連結，其他（例如 `javascript:`）只留文字。Markdown 寫成 `[文字](網址)`；純文字寫成 `文字 (網址)`，文字本身就是網址時不重複；Word 寫成超連結。 |
| 無效字元 | Word 匯出會移除 XML 1.0 不允許的控制字元與落單的代理字元，避免 Word 判定檔案損毀。 |

### 資料模型

```ts
interface Note {
  id: string;          // crypto.randomUUID()
  title: string;
  content: JSONContent; // Tiptap JSON
  createdAt: number;   // epoch ms
  updatedAt: number;
}
```

## 5. 轉接層

| 介面 | 網頁 | 桌面 Electron | 手機 Capacitor |
|---|---|---|---|
| `Storage` | IndexedDB | IndexedDB | IndexedDB |
| `FileSaver` | 瀏覽器下載 | 原生「另存新檔」對話框 | 系統分享選單（`@capacitor/share` + `@capacitor/filesystem`） |

```ts
interface Storage {
  list(): Promise<Note[]>;
  get(id: string): Promise<Note | undefined>;
  put(note: Note): Promise<void>;
  remove(id: string): Promise<void>;
}
interface FileSaver {
  save(filename: string, data: Blob): Promise<void>;
}
```

錄音不需轉接層，三端皆用標準 `MediaRecorder`。手機需在原生設定宣告麥克風權限（Android `RECORD_AUDIO`、iOS `NSMicrophoneUsageDescription`）。

## 6. 錄音流程

```
按「錄製」→ 取得麥克風權限 → MediaRecorder 開始
 → 於 4–8 秒間偵測到停頓即切段；8 秒仍無停頓則強制切
 → POST /transcribe（附 seq 與前一段文字作為 prompt）
 → 收到文字 → 依 seq 順序插入編輯器
按「停止」→ 上傳最後一段 → 錄製鈕恢復
```

1. **每段重開一個 MediaRecorder**，不用 `timeslice`（`timeslice` 的後續片段缺檔頭，無法獨立解碼）。段間約 20ms 空隙可接受。
2. **停頓偵測**：`AnalyserNode` 計算 RMS 音量，低於門檻持續 300ms 視為停頓。
3. **順序**：上傳可並行；結果放入以 `seq` 為鍵的緩衝，只在前一段已插入（或已標記失敗）時才插入下一段。
4. **插入位置**：按下「錄製」時的游標位置；該位置透過 Tiptap transaction mapping 追蹤，使用者錄音時打字不會打亂插入點。
5. **格式**：以 `MediaRecorder.isTypeSupported` 依序嘗試 `audio/webm;codecs=opus`、`audio/mp4`。

## 7. 後端 API

```
POST /transcribe
  Header: Authorization: Bearer <存取金鑰>
  Body (multipart/form-data): audio (File), seq (number), prompt (string, 可空)
  200 → { seq: number, text: string }
GET /health → 200 { ok: true }
```

- 送給模型的 `language` 為 `zh`；`prompt` 前綴一段繁體中文引導文字，回傳前以 `opencc-js`（簡→繁台灣）轉換。
- 單段上傳上限 5MB，超過回 413。
- 每把金鑰每分鐘 60 次，超過回 429 並帶 `Retry-After`。
- CORS 允許來源：網頁正式網域、`capacitor://localhost`、`http://localhost`、Electron 自訂協定 `app://`（Electron 以自訂協定載入頁面，不用 `file://`）。
- 環境變數：`OPENAI_API_KEY`、`ACCESS_KEYS`（逗號分隔）、`ALLOWED_ORIGINS`。
- 轉寫服務包在 `Transcriber` 介面後，日後可換 Groq／Azure。

## 8. 錯誤處理

| 狀況 | 處理 |
|---|---|
| 麥克風權限被拒 | 顯示提示與開啟權限步驟，不開始錄音 |
| 網路錯誤或 5xx | 重試 3 次（1s→2s→4s）；仍失敗則音訊存入本機佇列，編輯器插入「⚠ 第 N 段未轉寫・重試」，按下重送 |
| 401 | 停止錄音，開啟設定頁 |
| 413 | 記錄錯誤並略過該段（正常 8 秒段不會超過） |
| 429 | 依 `Retry-After` 等待後重送 |
| 未設定後端網址 | 錄製鈕顯示「請先設定」，按下開設定頁 |
| 手機切到背景導致錄音中斷 | 回前景時提示「錄音已中斷」，已錄部分照常上傳 |
| 回傳空字串 | 略過不插入 |

## 9. 測試

採 TDD：每個功能先寫失敗的測試，再寫實作。

| 層級 | 工具 | 內容 |
|---|---|---|
| 單元 | Vitest | 匯出器輸出、切段器（停頓切／8 秒強制切）、序號排序、重試與佇列 |
| 元件 | Vitest + Testing Library | 工具列套用格式、錄製鈕狀態、設定頁 |
| 後端 | Vitest + Hono `app.request()` | 401、429、413、簡轉繁；OpenAI 以 mock 取代 |
| 端對端 | Playwright（網頁） | 新增筆記→輸入→重新整理後仍在；假麥克風 + mock 後端跑完整錄音 |
| 實機 | 手動檢查表 | Electron（Windows）、Android、iOS 各錄 1 分鐘：權限、格式、背景中斷 |

## 10. 部署

- 網頁：靜態檔部署至 Vercel 或 Cloudflare Pages
- 後端：Docker 映像，可部署 Fly.io／Render／自有主機
- 桌面：electron-builder 產出 Windows `.exe` 安裝檔
- 手機：Capacitor 產生 Android Studio／Xcode 專案；iOS 需 Mac 建置

## 11. 里程碑

| # | 內容 | 預估 |
|---|---|---|
| M1 | monorepo + 網頁版編輯器、筆記清單、本機儲存 | 1 天 |
| M2 | 4 種匯出 + 複製 | 0.5 天 |
| M3 | 後端 `/transcribe` + 存取金鑰 + 網頁版錄音 | 1.5 天 |
| M4 | Electron 桌面版 | 0.5 天 |
| M5 | Capacitor Android（iOS 待有 Mac） | 1 天 |

合計約 4.5 天（不含 iOS）。
