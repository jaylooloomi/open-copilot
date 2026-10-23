# open-copilot

邊錄音邊轉成文字的語音筆記。錄音每 8–12 秒切成一段送到後端轉寫，文字依序插入筆記；筆記存在裝置本機（IndexedDB），可匯出 Markdown／Word／PDF，也可以產生 AI 摘要與待辦事項。

同一份畫面跑在三個地方：瀏覽器（可安裝的 PWA）、Windows 桌面版（Electron）、Android App（Capacitor）。

| 目錄 | 內容 | 說明文件 |
|---|---|---|
| `packages/core` | 所有畫面與邏輯（React + Tiptap） | |
| `packages/shared` | 前後端共用的 API 型別與限制 | |
| `apps/web` | 網頁入口、PWA、Android 專案（`apps/web/android`） | [apps/web/README.md](apps/web/README.md) |
| `apps/api` | 轉寫與 AI 後端（Hono + Node） | [apps/api/README.md](apps/api/README.md) |
| `apps/desktop` | Windows 桌面版 | [apps/desktop/README.md](apps/desktop/README.md) |
| `scripts/prototype.mjs` | `npm run prototype` 一鍵啟動器 | 本文件 |

## 快速開始

需要 Node 24（npm 11）。以下指令都在 repo 根目錄執行（Windows 用 Git Bash）。

```bash
npm install
npm run prototype
```

`npm run prototype` 會：

1. 選擇轉寫服務（見下一節）；一個都用不了時，印出申請免費 Groq 金鑰的步驟並結束，不啟動任何東西。
2. 沒有 `ACCESS_KEYS` 時產生一把隨機存取金鑰，存到 `apps/api/.env.local`（已被 git 忽略），之後重複使用。
3. 同時啟動後端 `http://localhost:8787` 和網頁 `http://localhost:5173`（網頁的 `/api/*` 轉到後端，不需要 CORS）。
4. 開啟瀏覽器到 `http://localhost:5173/#oc-setup=...`，自動填好後端網址和存取金鑰。這個網址含金鑰，不要分享。

按 Ctrl+C 一起關閉。8787 和 5173 必須空著。其他選項：

| 指令 | 用途 |
|---|---|
| `npm run prototype -- --no-open` | 不開瀏覽器，只印出網址 |
| `npm run prototype -- --check` | 後端與 `/api` proxy 都正常後自動結束，用來檢查環境 |
| `npm run prototype -- --share` | 另外產生手機用的公開網址和 QR code（見「在手機上用」） |

## 轉寫服務：Groq 金鑰或 Windows 離線辨識

後端依下列順序選擇（環境變數優先，其次 `apps/api/.env.local`，再來 `apps/api/.env`）：

1. `TRANSCRIBE_PROVIDER` 指定的服務（`groq`、`openai` 或 `windows`）。
2. 有 `GROQ_API_KEY`：Groq `whisper-large-v3-turbo`（免費額度即可，建議）。AI 摘要與待辦事項也需要這把金鑰。
3. 有 `OPENAI_API_KEY`：OpenAI `gpt-4o-mini-transcribe`。
4. 都沒有而且是 Windows：Windows 內建的 System.Speech 離線辨識（zh-TW）。
   - 需要 ffmpeg：`winget install Gyan.FFmpeg`，或用 `FFMPEG_PATH` 指定 `ffmpeg.exe` 的路徑。
   - 結果**沒有標點**，準確度也比 Groq 低；AI 摘要與待辦事項不能用。
   - 啟動時會印出「目前使用 Windows 內建離線辨識，設定 GROQ_API_KEY 可提高準確度」。

改用 Groq：到 <https://console.groq.com/keys> 建立金鑰，在 `apps/api/.env.local` 加一行 `GROQ_API_KEY=<你的金鑰>`，再執行一次 `npm run prototype`。所有環境變數見 [apps/api/README.md](apps/api/README.md#環境變數)。

## 在手機上用

### 分享網址（`npm run prototype -- --share`）

```bash
npm run prototype -- --share
```

啟動器會先建置網頁，用 `vite preview` 在 `http://localhost:4173` 提供建置版，再用 Cloudflare quick tunnel（npm 套件 `cloudflared`，免帳號）把它公開成 `https://<隨機名稱>.trycloudflare.com`，最後印出含 `#oc-setup` 的手機網址和 QR code。用手機相機掃 QR code，網頁就會填好設定，可以直接錄音。

- **網址是公開的。**只在測試時開啟，用完按 Ctrl+C 關閉。通道只會連到建置後的網頁和 `/api`，`/api` 仍然需要存取金鑰；網址含金鑰，只給自己的手機。
- 存取金鑰至少要 16 個字元，否則 `--share` 直接結束。自動產生的金鑰是 32 個字元。
- 每次執行網址都不一樣，手機上的筆記跟著網址走；要保留請在關閉前用「備份」匯出。
- 改了程式要按 Ctrl+C 重新執行（建置版不會熱更新）。
- 需要能連到 Cloudflare；`~/.cloudflared/config.yml` 存在時 quick tunnel 無法使用。

細節與疑難排解見 [apps/web/README.md](apps/web/README.md)（「手機分享網址」一節）。

### 安裝成 App

- **PWA**：用手機 Chrome 開啟 HTTPS 的建置版（分享網址或部署後的正式網址），選單選「安裝應用程式」。正式使用請部署到 Vercel 或 Cloudflare Pages，見 [apps/web/README.md](apps/web/README.md#部署到-vercel)。
- **Android App**：需要 JDK 21 和 Android Studio／SDK，執行 `npm run cap:sync -w @oc/web` 後用 `npm run android:open -w @oc/web` 或 `npm run android:run -w @oc/web` 建置安裝。App 的後端必須是 HTTPS（部署好的後端，或分享網址的 `https://<隨機名稱>.trycloudflare.com/api`）。步驟見 [apps/web/README.md](apps/web/README.md#android-appcapacitor)。

## Windows 桌面版

建置安裝檔：

```bash
npm run dist -w @oc/desktop
```

輸出 `apps/desktop/release/open-copilot-setup-<版本>.exe`。安裝檔沒有簽章，SmartScreen 會警告（「其他資訊」→「仍要執行」）；預設只裝給目前使用者。

搭配本機後端：先執行 `npm run prototype`，在桌面版「設定」的「後端網址」填 `http://localhost:8787`，「存取金鑰」填 `apps/api/.env.local` 裡 `ACCESS_KEYS=` 後面的值。詳見 [apps/desktop/README.md](apps/desktop/README.md)。

## 開發

| 指令 | 用途 |
|---|---|
| `npm test` | 所有 workspace 的單元測試 |
| `npm run typecheck` | 所有 workspace 的型別檢查 |
| `npm run test:workflow` | CI 設定與 `npm run prototype` 啟動器的測試 |
| `npm run e2e` | 網頁端對端測試（Playwright；第一次先 `npm exec -w @oc/web -- playwright install chromium`） |

各部分的開發、部署與測試細節：

- 網頁、PWA、Android、部署：[apps/web/README.md](apps/web/README.md)
- 後端、環境變數、Docker：[apps/api/README.md](apps/api/README.md)
- 桌面版：[apps/desktop/README.md](apps/desktop/README.md)
