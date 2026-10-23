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

## 一鍵啟動原型（`npm run prototype`）

在 repo 根目錄執行：

```bash
npm run prototype
```

啟動器（`scripts/prototype.mjs`）會：

1. 決定轉寫服務：環境變數、`apps/api/.env.local` 或 `apps/api/.env` 有 `GROQ_API_KEY` 或 `OPENAI_API_KEY` 就用雲端；都沒有時，在 Windows 上改用內建離線辨識，並印出「目前使用 Windows 內建離線辨識，設定 GROQ_API_KEY 可提高準確度」；沒有金鑰而且不是 Windows、或 Windows 上找不到 ffmpeg（`FFMPEG_PATH` 或 PATH 上的 `ffmpeg`）時，在啟動任何伺服器之前印出申請 Groq 金鑰的步驟並以 exit code 1 結束。
2. 沒有 `ACCESS_KEYS` 時產生一把隨機存取金鑰，寫進 `apps/api/.env.local`（已被 `.gitignore` 排除），之後重複使用。
3. 同時啟動後端（`http://localhost:8787`）和網頁開發伺服器（`http://localhost:5173`）。任何一個結束，另一個也會停止；按 Ctrl+C 會一起關閉。
4. 開啟瀏覽器到 `http://localhost:5173/#oc-setup=...`。網頁讀到 `#oc-setup` 後，把後端網址 `http://localhost:5173/api` 和存取金鑰存進設定，並立刻從網址列移除；格式不對、或後端網址和網頁不同源（別人做的連結可能把錄音導到其他網站）就忽略、保留原設定，只在主控台印一行警告。

選項：`npm run prototype -- --no-open`（不開瀏覽器，只印出網址）、`npm run prototype -- --check`（兩個服務和 `/api` proxy 都正常後自動結束，用來檢查環境）。

印出的網址含存取金鑰，不要分享。開發伺服器會把 `/api/*` 轉到 `http://localhost:8787/*`（`vite.config.ts` 的 `server.proxy`），所以網頁版是同源呼叫後端，不會遇到 CORS。8787 和 5173 必須空著。

Windows 離線辨識需要 ffmpeg（`winget install Gyan.FFmpeg`，或用 `FFMPEG_PATH` 指定），結果不含標點，準確度也比 Groq 低。

### 桌面版搭配原型後端

1. 先執行 `npm run prototype`，讓後端保持執行。
2. 開啟桌面版（`npm run dev -w @oc/desktop` 或安裝版），按右上齒輪開啟「設定」。
3. 「後端網址」填 `http://localhost:8787`；「存取金鑰」填 `apps/api/.env.local` 裡 `ACCESS_KEYS=` 後面的值（自訂了 `ACCESS_KEYS` 時填第一把）。按「測試連線」，再按「儲存」。

後端的 CORS 預設允許 `app://bundle`，不用另外設定。

## 真實語音端對端測試（`npm run e2e:real`）

不在預設的 `npm run e2e` 和 CI 裡，只能在 Windows 執行：

```bash
npm run e2e:real -w @oc/web
```

1. 用 PowerShell `System.Speech` 的繁中語音（優先 `Microsoft Hanhan`，沒有就用任一個 zh-TW 語音）把約 22 秒的固定句子合成 WAV（`apps/api/scripts/windows-tts.ps1`）。
2. Chromium 以這個 WAV 當麥克風（`--use-file-for-fake-audio-capture`）。
3. 啟動真的後端（8787，不讀 `apps/api/.env`）和網頁開發伺服器（5173），用 `#oc-setup` 填好設定，錄 25 秒後停止。
4. 通過條件：「會議」「測試」「版本」至少出現 2 個；沒有簡體字樣本（例如「这」「们」）；沒有未轉寫標記。

轉寫服務依後端的預設順序：這個 shell 有 `GROQ_API_KEY` 就真的呼叫 Groq，否則有 `OPENAI_API_KEY` 用 OpenAI，都沒有就用 Windows 離線辨識。輸出會印出 `[e2e:real] transcribe provider: ...` 和轉寫結果，HTML 報告（`apps/web/playwright-report/real`）的 annotation 也有記錄。

## 建置產物

`npm run build -w @oc/web` 只產生靜態檔，部署時上傳整個 `apps/web/dist`：

- `index.html`
- `assets/index-<hash>.js`、`assets/index-<hash>.css`（之後的里程碑會多出按需載入的 `assets/*-<hash>.js` 分塊）

建置不需要任何環境變數。後端網址與存取金鑰（M3 起）由使用者在 App 的「設定」輸入，存在該瀏覽器的 localStorage，不會寫進建置產物。

## 部署限制

- **必須放在網域根目錄**（例如 `https://notes.example.com/`），不可放在子路徑（例如 `https://example.com/notes/`）。Vite `base` 維持預設 `/`，`index.html` 以 `/assets/...` 絕對路徑載入程式；桌面版（Electron）與 Android（Capacitor）也共用同一份建置產物，不要為了子路徑修改 `base`。
- **必須是 HTTPS**。建立筆記用的 `crypto.randomUUID()` 與錄音用的麥克風只在安全環境（HTTPS 或 `localhost`）可用；用 `http://<區網 IP>` 開啟時建立不了第一篇筆記，畫面顯示「無法載入筆記，請再試一次。」，Console 顯示 `Failed to load notes TypeError: crypto.randomUUID is not a function`。Vercel 與 Cloudflare Pages 預設就是 HTTPS。
- **瀏覽器至少要 Chrome／Edge 98、Firefox 104、Safari 15.4（iOS 15.4）**。`vite.config.ts` 的 `build.target` 是 `es2022`，只轉換語法，不會補上瀏覽器缺少的 API，所以最低版本取下列各項中最高的：
  - `src/main.tsx` 的頂層 `await`（語法）：Chrome／Edge 89、Firefox 89、Safari 15。
  - 建立筆記用的 `structuredClone()`：Chrome／Edge 98、Firefox 94、Safari 15.4。
  - 建立筆記用的 `crypto.randomUUID()`：Chrome／Edge 92、Firefox 95、Safari 15.4。
  - Tiptap 編輯器每次編輯都會呼叫的 `Array.prototype.findLast`：Chrome／Edge 97、Firefox 104、Safari 15.4。

  低於最低版本時的症狀：
  - 不支援頂層 `await` 的瀏覽器（早於 Chrome／Edge 89、Firefox 89、Safari 15）停在空白頁，Console 顯示語法錯誤。
  - Chrome／Edge 89–97、Firefox 89–94、Safari 15.0–15.3 能載入程式，但第一次開啟時建立不了第一篇筆記，畫面顯示「無法載入筆記，請再試一次。」，Console 顯示 `Failed to load notes`。
  - Firefox 95–103 畫面正常，但在內文每輸入一個字，Console 就出現 `findLast is not a function`，內文的修改不會存檔，重新整理後就不見。
- **沒有前端路由**。整個 App 只有 `/` 一頁，不需要設定 SPA rewrite：Cloudflare Pages 在產物沒有 `404.html` 時會把未知路徑回成 `index.html`；Vercel 對未知路徑回 404，兩者都不影響使用。日後若加入前端路由，Vercel 要另外設定把所有路徑 rewrite 到 `/index.html`。
- **不要同時在兩個分頁編輯**（v1 限制）。每個分頁各自保留一份筆記並整篇寫回，分頁之間不同步：在較舊的分頁改任何東西，會蓋掉另一個分頁對同一篇筆記的修改；在空的資料庫同時開兩個分頁，也會各建一篇空白筆記。
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
