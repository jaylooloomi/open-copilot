# @oc/desktop

open-copilot 的 Windows 桌面版（Electron）。畫面與網頁版相同：視窗載入 `apps/web` 的建置產物，來源是 `app://bundle`（後端預設的 `ALLOWED_ORIGINS` 已包含，不用另外設定 CORS）。

以下指令都在 repo 根目錄以 Git Bash 執行。

| 指令 | 用途 |
|---|---|
| `npm run dev -w @oc/desktop` | 建置網頁與主程序後開啟開發版視窗。筆記存在 `%APPDATA%\open-copilot-dev`，和安裝版分開 |
| `npm run dist -w @oc/desktop` | 建置 Windows 安裝檔（見下方） |
| `npm test -w @oc/desktop` | 單元測試（Vitest） |
| `npm run typecheck -w @oc/desktop` | 型別檢查 |
| `npm run e2e -w @oc/desktop` | 端對端測試（Playwright 啟動 Electron，每次用空白的設定檔） |

## 建置安裝檔

```bash
npm install
npm run dist -w @oc/desktop
```

`dist` 依序建置網頁（`apps/web/dist`）、建置主程序（`apps/desktop/dist`），再用 electron-builder 打包成 NSIS 安裝檔：

- 輸出：`apps/desktop/release/open-copilot-setup-<版本>.exe`（版本是 `apps/desktop/package.json` 的 `version`，例如 `open-copilot-setup-0.1.0.exe`）。`release/` 已被 `.gitignore` 排除。
- 只產生 Windows x64 安裝檔，要在 Windows 上建置。第一次建置時 electron-builder 會下載 NSIS 等工具，需要網路。
- 安裝檔**沒有程式碼簽章**。執行時 Windows SmartScreen 會顯示「Windows 已保護您的電腦」，按「其他資訊」→「仍要執行」。要發給別人用，請先用自己的憑證簽章。
- 安裝精靈可選安裝位置，預設只裝給目前使用者（不需要系統管理員權限）。安裝後從開始功能表開啟 open-copilot；移除請用 Windows「設定 → 應用程式」。
- 筆記與設定存在 `%APPDATA%\open-copilot`（IndexedDB 與 localStorage），移除程式不會刪除它們。

## 連接後端

桌面版只有畫面，轉寫需要後端（`apps/api`）：

1. 在 repo 根目錄執行 `npm run prototype`（或自行啟動後端，見 `apps/api/README.md`），讓後端保持執行。
2. 開啟桌面版，按右上齒輪開啟「設定」。
3. 「後端網址」填 `http://localhost:8787`；「存取金鑰」填 `apps/api/.env.local` 裡 `ACCESS_KEYS=` 後面的值（自訂了 `ACCESS_KEYS` 時填第一把）。按「測試連線」，顯示「連線成功」後按「儲存」。

用部署好的後端時，「後端網址」改填那個 HTTPS 網址。
