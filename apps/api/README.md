# @oc/api — open-copilot 語音轉文字後端

Hono + Node 的小型 API：接收前端錄音切好的單段音訊，交給轉寫服務（預設 Groq `whisper-large-v3-turbo`，也可改用 OpenAI `gpt-4o-mini-transcribe`），並把結果轉成繁體中文（台灣）後回傳。

## API

| 方法與路徑 | 驗證 | 說明 |
|---|---|---|
| `GET /health` | 不需要 | 回 `200 { "ok": true }`，供設定頁「測試連線」使用 |
| `POST /transcribe` | `Authorization: Bearer <存取金鑰>` | `multipart/form-data`：`audio`（檔案，≤ 5MB）、`seq`（整數 ≥ 1）、`prompt`（字串，可省略）→ `200 { "seq": 1, "text": "..." }` |

錯誤一律回 `{ "error": "<code>" }`：

| 狀態碼 | `error` | 何時發生 |
|---|---|---|
| 400 | `bad_request` | 缺 `audio`、`audio` 為空或不是檔案、`seq` 不是正整數（或超過 `Number.MAX_SAFE_INTEGER`）、`prompt` 不是字串（例如以檔案送出）、body 不是 multipart |
| 401 | `unauthorized` | 缺少或錯誤的存取金鑰 |
| 404 | `bad_request` | 未知路徑或方法（例如 `GET /transcribe`、後端網址多了路徑前綴） |
| 413 | `payload_too_large` | 音訊超過 5MB |
| 429 | `rate_limited` | 同一把金鑰每分鐘超過 60 次，或轉寫服務（Groq／OpenAI）回 429。回應帶 `Retry-After`（秒）：上游 429 時轉傳上游的值，上游沒給就帶 `10` |
| 500 | `upstream_error` | 伺服器未預期的錯誤 |
| 502 | `upstream_error` | 轉寫服務失敗（429 以外，例如金鑰錯誤、服務故障、逾時） |

部署平台或反向代理自己產生的錯誤頁（例如逾時的 502／504）不經過本程式，可能不是 JSON；用戶端應以狀態碼為準。

CORS：只允許 `ALLOWED_ORIGINS` 內的來源，並公開 `Retry-After` 標頭給瀏覽器讀取。

## 轉寫服務

| `TRANSCRIBE_PROVIDER` | 需要的金鑰 | 模型 |
|---|---|---|
| `groq` | `GROQ_API_KEY` | `whisper-large-v3-turbo`（可用 `GROQ_TRANSCRIBE_MODEL` 覆寫） |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini-transcribe`（固定） |

沒設定 `TRANSCRIBE_PROVIDER` 時：有 `GROQ_API_KEY` 就用 Groq；否則有 `OPENAI_API_KEY` 就用 OpenAI；兩者都沒有就拒絕啟動，印出 `[config] No transcription API key: ...` 並以 exit code 1 結束。啟動成功時會印出 `[transcribe] provider groq, model whisper-large-v3-turbo`（不印金鑰）。

申請 Groq 金鑰：

1. 到 <https://console.groq.com> 註冊或登入。
2. 開啟 **API Keys** → **Create API Key**，複製 `gsk_` 開頭的金鑰（只會顯示一次）。
3. 填進 `apps/api/.env` 的 `GROQ_API_KEY`。

Groq 免費額度（設計時的數字）：每分鐘 20 次、每小時 7,200 音訊秒、每天 28,800 音訊秒、每天 2,000 次請求；每次請求最少按 10 秒計費。超過時 Groq 回 429，本服務改回 429 `rate_limited` 並轉傳 `Retry-After`，前端依此等待後重送。

prompt：前端會送前一段最後 200 字當 `prompt`。Whisper 系列的 prompt 上限是 224 tokens，所以後端只保留最後 80 個字，前面固定加上 `以下是繁體中文的語音內容。`。兩種轉寫服務都套用這個規則。

## 環境變數

| 名稱 | 必填 | 說明 |
|---|---|---|
| `TRANSCRIBE_PROVIDER` | 否 | `groq` 或 `openai`（不分大小寫）；不填則依上節規則自動選擇；其他值拒絕啟動 |
| `GROQ_API_KEY` | 二擇一 | Groq API 金鑰；使用 Groq 時必填 |
| `GROQ_TRANSCRIBE_MODEL` | 否 | Groq 轉寫模型，預設 `whisper-large-v3-turbo` |
| `OPENAI_API_KEY` | 二擇一 | OpenAI API 金鑰；使用 OpenAI 時必填 |
| `ACCESS_KEYS` | 是 | 存取金鑰，逗號分隔。每把請用至少 16 字元的隨機值（例如 `node -e "console.log(crypto.randomUUID())"`）；較短的金鑰仍可啟動，但會印出警告 |
| `ALLOWED_ORIGINS` | 否 | CORS 允許來源，逗號分隔；預設 `http://localhost:5173,https://localhost,capacitor://localhost,app://bundle`。每項只能是 `scheme://host[:port]`（例如 `https://notes.example.com`），不可有路徑或結尾斜線；格式不對會拒絕啟動 |
| `PORT` | 否 | 監聽埠，預設 `8787` |

伺服器固定連 `https://api.groq.com/openai/v1`（Groq）或 `https://api.openai.com/v1`（OpenAI）：OpenAI SDK 平常會讀的 `OPENAI_BASE_URL`、`OPENAI_ORG_ID`、`OPENAI_PROJECT_ID` 一律忽略，避免主機上為別的工具設定的值把音訊與金鑰送到別處。

## 本機執行

在 repo 根目錄（Windows 用 Git Bash）：

```bash
npm install
cp apps/api/.env.example apps/api/.env   # 填入 GROQ_API_KEY（或 OPENAI_API_KEY）與自訂 ACCESS_KEYS
npm run dev -w @oc/api                   # tsx watch，改檔自動重啟；會自動讀 apps/api/.env
```

注意：Node 的 `--env-file` 不會覆寫已存在的環境變數。若 shell 或 Windows 使用者環境變數已設定 `GROQ_API_KEY`、`OPENAI_API_KEY` 等同名變數，會以那個值為準、忽略 `.env`；例如主機上只有 `OPENAI_API_KEY`、`.env` 填了 `GROQ_API_KEY` 時，仍會選 Groq，但主機上的 `TRANSCRIBE_PROVIDER=openai` 會蓋過 `.env`。要確定使用 `.env` 的值，請這樣啟動：

```bash
(unset TRANSCRIBE_PROVIDER GROQ_API_KEY GROQ_TRANSCRIBE_MODEL OPENAI_API_KEY ACCESS_KEYS ALLOWED_ORIGINS PORT; npm run dev -w @oc/api)
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
npm test -w @oc/api          # Vitest；Groq／OpenAI 以假物件或假 fetch 取代，不連網
npm run typecheck -w @oc/api
```

## Docker

Build context 必須是 repo 根目錄（映像需要 `packages/shared`）：

```bash
docker build -f apps/api/Dockerfile -t open-copilot-api .
docker run --rm -p 8787:8787 --env-file apps/api/.env open-copilot-api
```

`--env-file` 內若設定了 `PORT`，`-p` 的容器埠要跟著改。

同一份 `.env` 要給 `docker run --env-file` 用時，值不可加引號：Node 的 `--env-file`（`npm run dev`）會去掉引號，Docker 會原樣保留，例如 `GROQ_API_KEY="gsk_..."` 進到容器就帶著引號，每次呼叫轉寫服務都會回 502 `upstream_error`。留空的 `NAME=` 視為未設定。

## 部署注意

- 放在 HTTPS 之後（Fly.io／Render 預設提供）；存取金鑰走 `Authorization` 標頭，不可用明文 HTTP 對外。
- 錯誤金鑰的嘗試不計入限流（限流依已通過驗證的金鑰計數），所以存取金鑰必須是長的隨機值，不能用 `dev-key` 這類好猜的字串對外。
- `ALLOWED_ORIGINS` 要加上網頁正式網域。
- 限流計數存在記憶體，只適用單一實例；要水平擴充需改成共用儲存（例如 Redis）。
- 每個 `/transcribe` 只呼叫轉寫服務一次（不重試）、單次逾時 25 秒，重試交給前端（前端每個請求 30 秒逾時）。用戶端斷線或逾時放棄時，進行中的上游呼叫會一併取消，不會和前端的重試疊在一起。反向代理的請求逾時請設在 30 秒以上，否則代理會比本程式先放棄。
- 要加新的轉寫服務時，實作 `src/transcriber/types.ts` 的 `Transcriber` 介面（把 `signal` 轉給上游呼叫，斷線時才會取消；上游 429 用 `src/transcriber/errors.ts` 的 `toUpstreamError` 轉換），在 `src/transcriber/createTranscriber.ts` 加一個 provider，並擴充 `src/config.ts` 的 `TRANSCRIBE_PROVIDER`。
