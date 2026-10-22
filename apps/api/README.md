# @oc/api — open-copilot 語音轉文字後端

Hono + Node 的小型 API：接收前端錄音切好的單段音訊，交給 OpenAI `gpt-4o-mini-transcribe` 轉寫，並把結果轉成繁體中文（台灣）後回傳。

## API

| 方法與路徑 | 驗證 | 說明 |
|---|---|---|
| `GET /health` | 不需要 | 回 `200 { "ok": true }`，供設定頁「測試連線」使用 |
| `POST /transcribe` | `Authorization: Bearer <存取金鑰>` | `multipart/form-data`：`audio`（檔案，≤ 5MB）、`seq`（整數 ≥ 1）、`prompt`（字串，可省略）→ `200 { "seq": 1, "text": "..." }` |

錯誤一律回 `{ "error": "<code>" }`：

| 狀態碼 | `error` | 何時發生 |
|---|---|---|
| 400 | `bad_request` | 缺 `audio`、`audio` 為空或不是檔案、`seq` 不是正整數、body 不是 multipart |
| 401 | `unauthorized` | 缺少或錯誤的存取金鑰 |
| 404 | `bad_request` | 未知路徑或方法（例如 `GET /transcribe`、後端網址多了路徑前綴） |
| 413 | `payload_too_large` | 音訊超過 5MB |
| 429 | `rate_limited` | 同一把金鑰每分鐘超過 60 次；回應帶 `Retry-After`（秒） |
| 500 | `upstream_error` | 伺服器未預期的錯誤 |
| 502 | `upstream_error` | 轉寫服務（OpenAI）失敗 |

部署平台或反向代理自己產生的錯誤頁（例如逾時的 502／504）不經過本程式，可能不是 JSON；用戶端應以狀態碼為準。

CORS：只允許 `ALLOWED_ORIGINS` 內的來源，並公開 `Retry-After` 標頭給瀏覽器讀取。

## 環境變數

| 名稱 | 必填 | 說明 |
|---|---|---|
| `OPENAI_API_KEY` | 是 | OpenAI API 金鑰 |
| `ACCESS_KEYS` | 是 | 存取金鑰，逗號分隔 |
| `ALLOWED_ORIGINS` | 否 | CORS 允許來源，逗號分隔；預設 `http://localhost:5173,https://localhost,capacitor://localhost,app://bundle` |
| `PORT` | 否 | 監聽埠，預設 `8787` |

## 本機執行

在 repo 根目錄（Windows 用 Git Bash）：

```bash
npm install
cp apps/api/.env.example apps/api/.env   # 填入真正的 OPENAI_API_KEY 與自訂 ACCESS_KEYS
npm run dev -w @oc/api                   # tsx watch，改檔自動重啟；會自動讀 apps/api/.env
```

注意：Node 的 `--env-file` 不會覆寫已存在的環境變數。若 shell 或 Windows 使用者環境變數已設定 `OPENAI_API_KEY` 等同名變數，會以那個值為準、忽略 `.env`。要確定使用 `.env` 的值，請這樣啟動：

```bash
(unset OPENAI_API_KEY ACCESS_KEYS ALLOWED_ORIGINS PORT; npm run dev -w @oc/api)
```

驗證：

```bash
curl http://localhost:8787/health
curl -X POST http://localhost:8787/transcribe \
  -H "Authorization: Bearer <你的存取金鑰>" \
  -F seq=1 -F "audio=@/path/to/clip.webm;type=audio/webm"
```

前端「設定」頁的後端網址填 `http://localhost:8787`，存取金鑰填 `ACCESS_KEYS` 其中一把。

## 測試

```bash
npm test -w @oc/api          # Vitest，OpenAI 以假物件取代，不連網
npm run typecheck -w @oc/api
```

## Docker

Build context 必須是 repo 根目錄（映像需要 `packages/shared`）：

```bash
docker build -f apps/api/Dockerfile -t open-copilot-api .
docker run --rm -p 8787:8787 --env-file apps/api/.env open-copilot-api
```

`--env-file` 內若設定了 `PORT`，`-p` 的容器埠要跟著改。

## 部署注意

- 放在 HTTPS 之後（Fly.io／Render 預設提供）；存取金鑰走 `Authorization` 標頭，不可用明文 HTTP 對外。
- `ALLOWED_ORIGINS` 要加上網頁正式網域。
- 限流計數存在記憶體，只適用單一實例；要水平擴充需改成共用儲存（例如 Redis）。
- 每個 `/transcribe` 只呼叫 OpenAI 一次（不重試）、單次逾時 25 秒，重試交給前端（前端每個請求 30 秒逾時）。反向代理的請求逾時請設在 30 秒以上，否則代理會比本程式先放棄。
- 要換轉寫服務（Groq、Azure…）時，實作 `src/transcriber/types.ts` 的 `Transcriber` 介面並在 `src/server.ts` 換掉即可。
