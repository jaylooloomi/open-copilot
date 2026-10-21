# M3a 後端 /transcribe API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `apps/api` 建立 Hono 後端，提供 `GET /health` 與需存取金鑰的 `POST /transcribe`（OpenAI `gpt-4o-mini-transcribe` 轉寫、簡轉繁、5MB 上限、每把金鑰每分鐘 60 次），並可用 Docker 部署。

**Architecture:** `createApp(deps)` 只組裝中介層與路由，所有外部依賴（轉寫服務、金鑰清單、允許來源、時鐘）都由參數注入，因此測試全部用 `app.request()` 加假的 `Transcriber` 與可控時鐘完成，不碰網路。`/transcribe` 的中介層順序固定為 CORS → bearerAuth → rateLimit → bodyLimit → handler，未知路徑與未預期例外由 `app.notFound`／`app.onError` 轉成 JSON；`server.ts` 是唯一讀取 `process.env` 並啟動 `@hono/node-server` 的地方。

**Tech Stack:** Node 24、TypeScript 5、Hono 4（`hono/cors`、`hono/body-limit`、`hono/factory`）、`@hono/node-server` 1、`openai` 5、`opencc-js` 1、`tsx` 4、Vitest 3、Docker（`node:24-slim`）。

---

## 前置條件與相依

- 只依賴 M1 產出的 monorepo 根目錄（`package.json` 含 `"workspaces": ["packages/*", "apps/*"]`、`tsconfig.base.json`、`.gitignore` 含 `.env`）與 `packages/shared`（`@oc/shared`，`src/api.ts` 內容如總覽契約 §4）。
- 本計畫不修改 `packages/shared`、`packages/core`、`apps/web`。
- 給 M3b 的保證：**本程式產生的**所有錯誤回應都是 `ApiErrorBody` JSON——包含 `POST /transcribe` 的 400／401／413／429／502、未知路徑或方法的 404（`{ error: 'bad_request' }`，由 `app.notFound` 產生）、未預期例外的 500（`{ error: 'upstream_error' }`，由 `app.onError` 產生）；這些回應都帶 CORS 標頭；`Retry-After` 透過 `Access-Control-Expose-Headers` 公開，瀏覽器 `fetch` 讀得到。
- 不在保證內：部署平台或反向代理自己產生的錯誤頁（例如逾時的 502／504）不經過本程式，可能是 HTML 或純文字。M3b 必須以 `res.status` 判斷結果，body 解析失敗時仍以狀態碼建立 `ApiError`，不可假設錯誤 body 一定是 JSON。

## 契約對齊說明

1. **不建立 `apps/api/src/types/opencc-js.d.ts`（總覽契約已同步修正）。** `opencc-js@1.4.x` 已自帶型別（`package.json` 的 `exports["."].types` 指向 `./types/full.d.ts`，具名匯出 `Converter`）。再寫一份環境宣告會遮蔽套件型別、日後升版時互相矛盾，所以直接使用套件型別；本計畫的 `package.json` 鎖定 `opencc-js@^1.4.0` 以確保有型別。總覽 §4「後端（M3a）」的 `toTraditional` 條目與 §6 第 6 點已改為「自帶型別，不需 d.ts」；Task 12 Step 4 會檢查此檔不存在。
2. **`hono` 鎖定 `^4.13.0`（仍在契約的 `^4` 內）。** 4.13 的 `bodyLimit` 在沒有 `Content-Length` 時會先把 body 讀進來並計數、超過就直接呼叫 `onError`，之後才交給 handler。`app.request()` 送出的請求不帶 `Content-Length`，所以 Task 8 的 `rejects an oversized body in bodyLimit before parsing` 走的正是這條路徑；Task 9 的 `checks the rate limit before bodyLimit reads an oversized body` 用同一種 body 確認限流會先擋下。
3. **`cn` → `tw` 只轉字形、不轉用詞。** 「软件」會變成「軟件」而非「軟體」，屬預期（總覽 §6 第 6 點）；人工檢查表依此判斷。

## File Structure

| 檔案 | 動作 | 單一職責 |
|---|---|---|
| `apps/api/package.json` | Create | `@oc/api` 工作區：依賴、`dev`／`start`／`test`／`typecheck` scripts |
| `apps/api/tsconfig.json` | Create | 繼承 `tsconfig.base.json`，改用 `lib: ["ES2022"]` + Node 型別（不含 DOM） |
| `apps/api/vitest.config.ts` | Create | Vitest 3：`environment: 'node'`、只收 `src/**/*.test.ts` |
| `apps/api/src/config.ts` | Create | `loadConfig(env)`：解析並驗證環境變數 |
| `apps/api/src/config.test.ts` | Create | `loadConfig` 單元測試 |
| `apps/api/src/text/toTraditional.ts` | Create | `toTraditional(text)`：opencc-js `cn` → `tw` |
| `apps/api/src/text/toTraditional.test.ts` | Create | 簡轉繁單元測試 |
| `apps/api/src/transcriber/types.ts` | Create | `Transcriber` 介面（日後可換 Groq／Azure） |
| `apps/api/src/transcriber/openaiTranscriber.ts` | Create | `createOpenAITranscriber(apiKey, client?)`、`buildPrompt` |
| `apps/api/src/transcriber/openaiTranscriber.test.ts` | Create | 以假 OpenAI client 驗證參數與錯誤傳遞 |
| `apps/api/src/middleware/auth.ts` | Create | `bearerAuth(accessKeys)`、`AuthEnv` 型別 |
| `apps/api/src/middleware/auth.test.ts` | Create | 401／通過／`c.get('accessKey')` |
| `apps/api/src/middleware/rateLimit.ts` | Create | `rateLimit({ limit, windowMs, now })` 固定視窗、依金鑰計數 |
| `apps/api/src/middleware/rateLimit.test.ts` | Create | 429、`Retry-After` 進位、各金鑰獨立、視窗重置 |
| `apps/api/src/app.ts` | Create（Task 6–9 逐步擴充） | `createApp(deps)`：CORS、`/health`、`/transcribe`、JSON 404／500 後援 |
| `apps/api/src/test/helpers.ts` | Create | 測試共用：假轉寫服務、`createTestApp`、表單與請求工具 |
| `apps/api/src/app.health.test.ts` | Create | `/health` 免驗證、CORS 預檢允許／拒絕 |
| `apps/api/src/app.transcribe.test.ts` | Create | 401（缺／錯金鑰）、200 成功與簡轉繁 |
| `apps/api/src/app.validation.test.ts` | Create | 400 欄位錯誤、413 超過大小（含只會被 `bodyLimit` 擋下的原始 body） |
| `apps/api/src/app.limits.test.ts` | Create | 429 + `Retry-After`、限流先於 `bodyLimit`、502 上游錯誤、JSON 404／500 |
| `apps/api/src/server.ts` | Create | 讀 env、`serve()`、SIGINT／SIGTERM 優雅關閉 |
| `apps/api/.env.example` | Create | 列出 `OPENAI_API_KEY`、`ACCESS_KEYS`、`ALLOWED_ORIGINS`、`PORT` |
| `apps/api/Dockerfile` | Create | 以 repo 根目錄為 build context 的兩階段映像；安裝前把 workspaces 修剪為 `packages/shared`、`apps/api`，`node --import tsx` 執行 |
| `.dockerignore` | Create | 排除 `node_modules`、`.env` 與 `.env.*`（保留 `.env.example`）、建置產物等，避免送進 build context |
| `apps/api/README.md` | Create | API 說明、環境變數、本機執行、測試、Docker、部署注意事項 |
| `package-lock.json` | Modify | `npm install` 自動更新 |

---

### Task 1: 建立 `@oc/api` 工作區與 `loadConfig`

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/src/config.ts`
- Test: `apps/api/src/config.test.ts`
- Modify: `package-lock.json`（由 npm 產生）

- [ ] **Step 1: 確認 M1 的共用契約已存在**

Run（Git Bash，repo 根目錄 `D:\git\open-copilot`）:
```bash
grep -nE "MAX_AUDIO_BYTES|RATE_LIMIT_PER_MINUTE|TranscribeResponse|HealthResponse|ApiErrorBody" packages/shared/src/api.ts
grep -n "workspaces" package.json
test -f tsconfig.base.json && echo "base tsconfig ok"
```
Expected: 第一行指令印出 5 行以上的匹配（含 `export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;`），第二行印出 `"workspaces": ["packages/*", "apps/*"]`，第三行印出 `base tsconfig ok`。任何一項沒有輸出就停止，回報「M1 的 packages/shared 或 monorepo 根設定未完成」。

- [ ] **Step 2: 建立 `apps/api/package.json`**

```json
{
  "name": "@oc/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file-if-exists=.env src/server.ts",
    "start": "tsx --env-file-if-exists=.env src/server.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hono/node-server": "^1.19.0",
    "@oc/shared": "*",
    "hono": "^4.13.0",
    "openai": "^5.23.0",
    "opencc-js": "^1.4.0",
    "tsx": "^4.20.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

說明：`tsx` 放在 `dependencies`，因為 Docker 映像只裝正式依賴、並用 tsx 執行。`--env-file-if-exists` 需 Node ≥ 22.9（開發機 Node 24）；`.env` 不存在時不會報錯。`"@oc/shared": "*"` 讓 npm workspaces 直接連結本機套件。

- [ ] **Step 3: 建立 `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "vitest.config.ts"]
}
```

說明：後端不需要 DOM 型別；`File`、`FormData`、`Request`、`Response` 由 `@types/node` 的全域型別提供，覆寫 `lib` 可避免 base 若含 DOM 時兩套型別混用。

- [ ] **Step 4: 建立 `apps/api/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: 安裝依賴**

Run:
```bash
npm install
npm ls -w @oc/api --depth=0
```
Expected: `npm install` 成功結束（可能有 audit 提示，忽略）。`npm ls` 列出：
```
`-- @oc/api@0.0.0 -> .\apps\api
  +-- @hono/node-server@1.x.x
  +-- @oc/shared@0.0.0 -> .\packages\shared
  +-- @types/node@24.x.x
  +-- hono@4.x.x        (≥ 4.13)
  +-- openai@5.x.x
  +-- opencc-js@1.x.x   (≥ 1.4)
  +-- tsx@4.x.x
  +-- typescript@5.x.x
  `-- vitest@3.x.x
```

- [ ] **Step 6: 寫失敗的測試 `apps/api/src/config.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_ALLOWED_ORIGINS, loadConfig } from './config';

const base = { OPENAI_API_KEY: 'sk-test', ACCESS_KEYS: 'key-a' };

describe('loadConfig', () => {
  it('throws when OPENAI_API_KEY is missing or blank', () => {
    expect(() => loadConfig({ ACCESS_KEYS: 'key-a' })).toThrow('OPENAI_API_KEY');
    expect(() => loadConfig({ ...base, OPENAI_API_KEY: '   ' })).toThrow('OPENAI_API_KEY');
  });

  it('throws when ACCESS_KEYS is missing or only separators', () => {
    expect(() => loadConfig({ OPENAI_API_KEY: 'sk-test' })).toThrow('ACCESS_KEYS');
    expect(() => loadConfig({ ...base, ACCESS_KEYS: ' , ,' })).toThrow('ACCESS_KEYS');
  });

  it('splits and trims comma-separated lists', () => {
    const config = loadConfig({
      ...base,
      ACCESS_KEYS: ' key-a , key-b,,',
      ALLOWED_ORIGINS: 'https://notes.example.com, app://bundle ',
    });
    expect(config.accessKeys).toEqual(['key-a', 'key-b']);
    expect(config.allowedOrigins).toEqual(['https://notes.example.com', 'app://bundle']);
  });

  it('uses default origins and port when not set', () => {
    const config = loadConfig(base);
    expect(config).toEqual({
      openaiApiKey: 'sk-test',
      accessKeys: ['key-a'],
      allowedOrigins: [
        'http://localhost:5173',
        'https://localhost',
        'capacitor://localhost',
        'app://bundle',
      ],
      port: 8787,
    });
    expect(config.allowedOrigins).not.toBe(DEFAULT_ALLOWED_ORIGINS);
  });

  it('parses PORT and rejects invalid values', () => {
    expect(loadConfig({ ...base, PORT: '3000' }).port).toBe(3000);
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow('PORT');
    expect(() => loadConfig({ ...base, PORT: '70000' })).toThrow('PORT');
  });
});
```

- [ ] **Step 7: 執行測試確認失敗**

Run: `npm test -w @oc/api -- src/config.test.ts`
Expected: FAIL，`Error: Cannot find module './config' imported from '.../apps/api/src/config.test.ts'`（Caused by: `Failed to load url ./config ... Does the file exist?`），`Test Files  1 failed (1)`。

- [ ] **Step 8: 實作 `apps/api/src/config.ts`**

```ts
export interface AppConfig {
  openaiApiKey: string;
  accessKeys: string[];
  allowedOrigins: string[];
  port: number;
}

export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  'http://localhost:5173',
  'https://localhost',
  'capacitor://localhost',
  'app://bundle',
];

export const DEFAULT_PORT = 8787;

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const openaiApiKey = env['OPENAI_API_KEY']?.trim();
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY is required');
  }

  const accessKeys = splitList(env['ACCESS_KEYS']);
  if (accessKeys.length === 0) {
    throw new Error('ACCESS_KEYS is required (comma-separated list of access keys)');
  }

  const origins = splitList(env['ALLOWED_ORIGINS']);
  const allowedOrigins = origins.length > 0 ? origins : [...DEFAULT_ALLOWED_ORIGINS];

  const rawPort = env['PORT']?.trim();
  const port = rawPort ? Number(rawPort) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${rawPort}"`);
  }

  return { openaiApiKey, accessKeys, allowedOrigins, port };
}
```

說明：用 `env['X']` 而非 `env.X`，即使 base tsconfig 開了 `noPropertyAccessFromIndexSignature` 也能編譯。

- [ ] **Step 9: 執行測試確認通過**

Run: `npm test -w @oc/api -- src/config.test.ts`
Expected:
```
 ✓ src/config.test.ts (5 tests)
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

- [ ] **Step 10: 型別檢查**

Run: `npm run typecheck -w @oc/api`
Expected: 只印出 `> @oc/api@0.0.0 typecheck` 與 `> tsc --noEmit`，沒有錯誤，exit code 0。

- [ ] **Step 11: Commit**

```bash
git add apps/api/package.json apps/api/tsconfig.json apps/api/vitest.config.ts apps/api/src/config.ts apps/api/src/config.test.ts package-lock.json
git commit -m "feat(api): scaffold @oc/api workspace with env config loader"
```

---

### Task 2: 簡轉繁 `toTraditional`

**Files:**
- Create: `apps/api/src/text/toTraditional.ts`
- Test: `apps/api/src/text/toTraditional.test.ts`

- [ ] **Step 1: 寫失敗的測試 `apps/api/src/text/toTraditional.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { toTraditional } from './toTraditional';

describe('toTraditional', () => {
  it('converts simplified Chinese to Taiwan traditional Chinese', () => {
    expect(toTraditional('这是简体中文')).toBe('這是簡體中文');
    expect(toTraditional('后来我们去开会')).toBe('後來我們去開會');
  });

  it('leaves traditional Chinese, ASCII and empty strings unchanged', () => {
    expect(toTraditional('這是繁體中文')).toBe('這是繁體中文');
    expect(toTraditional('OK, 123!')).toBe('OK, 123!');
    expect(toTraditional('')).toBe('');
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm test -w @oc/api -- src/text/toTraditional.test.ts`
Expected: FAIL，`Error: Cannot find module './toTraditional' imported from '.../src/text/toTraditional.test.ts'`。

- [ ] **Step 3: 實作 `apps/api/src/text/toTraditional.ts`**

```ts
import { Converter } from 'opencc-js';

// 建一次即可重複使用；cn = 簡體中文（中國大陸），tw = 繁體中文（台灣）。
const convertCnToTw = Converter({ from: 'cn', to: 'tw' });

export function toTraditional(text: string): string {
  return convertCnToTw(text);
}
```

說明：`opencc-js@1.4` 自帶型別並提供 ESM 具名匯出 `Converter`，因此不建立 `src/types/opencc-js.d.ts`（見「契約對齊說明」第 1 點與總覽 §6 第 6 點）。`to: 'tw'` 只做字形與台灣異體字轉換，不轉用詞（「软件」→「軟件」）；這是契約指定的行為，不要改成 `twp`。

- [ ] **Step 4: 執行測試確認通過**

Run: `npm test -w @oc/api -- src/text/toTraditional.test.ts`
Expected:
```
 ✓ src/text/toTraditional.test.ts (2 tests)
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

- [ ] **Step 5: 型別檢查**

Run: `npm run typecheck -w @oc/api`
Expected: 無錯誤，exit code 0。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/text/toTraditional.ts apps/api/src/text/toTraditional.test.ts
git commit -m "feat(api): add simplified-to-traditional Chinese conversion"
```

---

### Task 3: `Transcriber` 介面與 OpenAI 實作

**Files:**
- Create: `apps/api/src/transcriber/types.ts`
- Create: `apps/api/src/transcriber/openaiTranscriber.ts`
- Test: `apps/api/src/transcriber/openaiTranscriber.test.ts`

- [ ] **Step 1: 建立介面 `apps/api/src/transcriber/types.ts`**

```ts
export interface TranscribeInput {
  /** 單段音訊（webm/opus 或 mp4）；檔名需帶副檔名，OpenAI 依副檔名判斷格式。 */
  file: File;
  /** 前一段已轉寫的文字，可為空字串。 */
  prompt: string;
}

export interface Transcriber {
  transcribe(input: TranscribeInput): Promise<string>;
}
```

- [ ] **Step 2: 寫失敗的測試 `apps/api/src/transcriber/openaiTranscriber.test.ts`**

```ts
import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import {
  PROMPT_PREFIX,
  TRANSCRIBE_MODEL,
  buildPrompt,
  createOpenAITranscriber,
} from './openaiTranscriber';

function createFakeClient(create: (...args: unknown[]) => Promise<unknown>) {
  const spy = vi.fn(create);
  const client = { audio: { transcriptions: { create: spy } } } as unknown as OpenAI;
  return { client, create: spy };
}

const file = new File([new Uint8Array([1, 2, 3])], 'segment-1.webm', { type: 'audio/webm' });

describe('buildPrompt', () => {
  it('prefixes the traditional Chinese guide text', () => {
    expect(buildPrompt('上一段的內容')).toBe('以下是繁體中文的語音內容。上一段的內容');
  });

  it('returns only the prefix for blank input', () => {
    expect(buildPrompt('   ')).toBe(PROMPT_PREFIX);
    expect(buildPrompt('')).toBe(PROMPT_PREFIX);
  });
});

describe('createOpenAITranscriber', () => {
  it('calls gpt-4o-mini-transcribe with zh language and prefixed prompt', async () => {
    const { client, create } = createFakeClient(async () => ({ text: '大家好' }));
    const transcriber = createOpenAITranscriber('sk-test', client);

    const text = await transcriber.transcribe({ file, prompt: '前文' });

    expect(text).toBe('大家好');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      file,
      model: TRANSCRIBE_MODEL,
      language: 'zh',
      prompt: '以下是繁體中文的語音內容。前文',
      response_format: 'json',
    });
    expect(TRANSCRIBE_MODEL).toBe('gpt-4o-mini-transcribe');
  });

  it('propagates client errors', async () => {
    const { client } = createFakeClient(async () => {
      throw new Error('upstream down');
    });
    const transcriber = createOpenAITranscriber('sk-test', client);

    await expect(transcriber.transcribe({ file, prompt: '' })).rejects.toThrow('upstream down');
  });

  it('builds a real client when none is injected (no network call)', () => {
    const transcriber = createOpenAITranscriber('sk-test');
    expect(typeof transcriber.transcribe).toBe('function');
  });
});
```

- [ ] **Step 3: 執行測試確認失敗**

Run: `npm test -w @oc/api -- src/transcriber/openaiTranscriber.test.ts`
Expected: FAIL，`Error: Cannot find module './openaiTranscriber' imported from '.../src/transcriber/openaiTranscriber.test.ts'`。

- [ ] **Step 4: 實作 `apps/api/src/transcriber/openaiTranscriber.ts`**

```ts
import OpenAI from 'openai';
import type { Transcriber } from './types';

export const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
export const PROMPT_PREFIX = '以下是繁體中文的語音內容。';

export function buildPrompt(previousText: string): string {
  const trimmed = previousText.trim();
  return trimmed ? `${PROMPT_PREFIX}${trimmed}` : PROMPT_PREFIX;
}

export function createOpenAITranscriber(apiKey: string, client?: OpenAI): Transcriber {
  // 前端已有 3 次重試，這裡只讓 SDK 重試 1 次並把逾時壓在 30 秒，避免單段卡住整條佇列。
  const openai = client ?? new OpenAI({ apiKey, timeout: 30_000, maxRetries: 1 });
  return {
    async transcribe({ file, prompt }) {
      const result = await openai.audio.transcriptions.create({
        file,
        model: TRANSCRIBE_MODEL,
        language: 'zh',
        prompt: buildPrompt(prompt),
        response_format: 'json',
      });
      return result.text;
    },
  };
}
```

說明：`openai@5` 的 `audio.transcriptions.create` 對 `response_format: 'json'` 的多載回傳 `Transcription`（有 `text`）；`file` 型別為 `Uploadable`，接受全域 `File`。

- [ ] **Step 5: 執行測試確認通過**

Run: `npm test -w @oc/api -- src/transcriber/openaiTranscriber.test.ts`
Expected:
```
 ✓ src/transcriber/openaiTranscriber.test.ts (5 tests)
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

- [ ] **Step 6: 型別檢查**

Run: `npm run typecheck -w @oc/api`
Expected: 無錯誤，exit code 0。

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/transcriber/types.ts apps/api/src/transcriber/openaiTranscriber.ts apps/api/src/transcriber/openaiTranscriber.test.ts
git commit -m "feat(api): add Transcriber interface and OpenAI implementation"
```

---

### Task 4: 存取金鑰驗證 `bearerAuth`

**Files:**
- Create: `apps/api/src/middleware/auth.ts`
- Test: `apps/api/src/middleware/auth.test.ts`

- [ ] **Step 1: 寫失敗的測試 `apps/api/src/middleware/auth.test.ts`**

```ts
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { bearerAuth, type AuthEnv } from './auth';

function createProtectedApp() {
  const app = new Hono<AuthEnv>();
  app.use('/protected', bearerAuth(['key-a', 'key-b']));
  app.get('/protected', (c) => c.text(c.get('accessKey')));
  return app;
}

describe('bearerAuth', () => {
  it('returns 401 with unauthorized body when the header is missing', async () => {
    const res = await createProtectedApp().request('/protected');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
  });

  it('returns 401 for a wrong key, a non-Bearer scheme or an empty token', async () => {
    const app = createProtectedApp();
    for (const value of ['Bearer wrong', 'Basic key-a', 'Bearer ', 'key-a']) {
      const res = await app.request('/protected', { headers: { Authorization: value } });
      expect(res.status, value).toBe(401);
    }
  });

  it('passes through and exposes the matched key', async () => {
    const app = createProtectedApp();
    const resA = await app.request('/protected', { headers: { Authorization: 'Bearer key-a' } });
    expect(resA.status).toBe(200);
    expect(await resA.text()).toBe('key-a');

    const resB = await app.request('/protected', { headers: { Authorization: 'bearer key-b' } });
    expect(resB.status).toBe(200);
    expect(await resB.text()).toBe('key-b');
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm test -w @oc/api -- src/middleware/auth.test.ts`
Expected: FAIL，`Error: Cannot find module './auth' imported from '.../src/middleware/auth.test.ts'`。

- [ ] **Step 3: 實作 `apps/api/src/middleware/auth.ts`**

```ts
import { createHash, timingSafeEqual } from 'node:crypto';
import type { ApiErrorBody } from '@oc/shared';
import { createMiddleware } from 'hono/factory';

export type AuthEnv = { Variables: { accessKey: string } };

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function bearerAuth(accessKeys: string[]) {
  // 先雜湊成固定 32 bytes，timingSafeEqual 才不會因長度不同而丟錯或洩漏長度。
  const known = accessKeys.map((key) => ({ key, digest: sha256(key) }));

  return createMiddleware<AuthEnv>(async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
    const token = match?.[1] ?? '';
    const tokenDigest = sha256(token);

    // 每把金鑰都比對、不提早結束，避免從回應時間推測是哪一把。
    let matchedKey: string | undefined;
    for (const entry of known) {
      if (timingSafeEqual(entry.digest, tokenDigest)) {
        matchedKey = entry.key;
      }
    }

    if (token === '' || matchedKey === undefined) {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json({ error: 'unauthorized' } satisfies ApiErrorBody, 401);
    }

    c.set('accessKey', matchedKey);
    await next();
  });
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npm test -w @oc/api -- src/middleware/auth.test.ts`
Expected:
```
 ✓ src/middleware/auth.test.ts (3 tests)
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

- [ ] **Step 5: 型別檢查**

Run: `npm run typecheck -w @oc/api`
Expected: 無錯誤，exit code 0。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/middleware/auth.ts apps/api/src/middleware/auth.test.ts
git commit -m "feat(api): add bearer access-key auth middleware"
```

---

### Task 5: 依金鑰限流 `rateLimit`（可注入時鐘）

**Files:**
- Create: `apps/api/src/middleware/rateLimit.ts`
- Test: `apps/api/src/middleware/rateLimit.test.ts`

- [ ] **Step 1: 寫失敗的測試 `apps/api/src/middleware/rateLimit.test.ts`**

```ts
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthEnv } from './auth';
import { rateLimit } from './rateLimit';

let clock = 0;

function createLimitedApp(limit = 2) {
  const app = new Hono<AuthEnv>();
  // Stand-in for bearerAuth: take the key from a test header.
  app.use(
    '*',
    createMiddleware<AuthEnv>(async (c, next) => {
      c.set('accessKey', c.req.header('x-test-key') ?? 'key-a');
      await next();
    }),
  );
  app.use('*', rateLimit({ limit, windowMs: 60_000, now: () => clock }));
  app.get('/', (c) => c.text('ok'));
  return app;
}

const hit = (app: Hono<AuthEnv>, key = 'key-a') =>
  app.request('/', { headers: { 'x-test-key': key } });

describe('rateLimit', () => {
  beforeEach(() => {
    clock = 1_000_000;
  });

  it('allows up to the limit, then returns 429 with Retry-After in whole seconds', async () => {
    const app = createLimitedApp(2);
    expect((await hit(app)).status).toBe(200);
    expect((await hit(app)).status).toBe(200);

    const res = await hit(app);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('rounds Retry-After up to the next second', async () => {
    const app = createLimitedApp(1);
    await hit(app);
    clock += 30_500; // 29.5 s left in the window
    const res = await hit(app);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');

    clock += 29_499; // 1 ms left
    expect((await hit(app)).headers.get('Retry-After')).toBe('1');
  });

  it('counts each access key separately', async () => {
    const app = createLimitedApp(1);
    expect((await hit(app, 'key-a')).status).toBe(200);
    expect((await hit(app, 'key-a')).status).toBe(429);
    expect((await hit(app, 'key-b')).status).toBe(200);
  });

  it('starts a fresh window once windowMs has elapsed', async () => {
    const app = createLimitedApp(1);
    expect((await hit(app)).status).toBe(200);
    expect((await hit(app)).status).toBe(429);
    clock += 60_000;
    expect((await hit(app)).status).toBe(200);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm test -w @oc/api -- src/middleware/rateLimit.test.ts`
Expected: FAIL，`Error: Cannot find module './rateLimit' imported from '.../src/middleware/rateLimit.test.ts'`。

- [ ] **Step 3: 實作 `apps/api/src/middleware/rateLimit.ts`**

```ts
import type { ApiErrorBody } from '@oc/shared';
import { createMiddleware } from 'hono/factory';
import type { AuthEnv } from './auth';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

interface Bucket {
  windowStart: number;
  count: number;
}

/**
 * 固定視窗限流：每把金鑰在第一次請求時開窗，窗內最多 limit 次。
 * 狀態只存在記憶體，僅適用單一實例部署。
 */
export function rateLimit({ limit, windowMs, now = Date.now }: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();

  return createMiddleware<AuthEnv>(async (c, next) => {
    const key = c.get('accessKey') ?? 'anonymous';
    const t = now();

    let bucket = buckets.get(key);
    if (!bucket || t >= bucket.windowStart + windowMs) {
      bucket = { windowStart: t, count: 0 };
      buckets.set(key, bucket);
    }

    if (bucket.count >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStart + windowMs - t) / 1000));
      c.header('Retry-After', String(retryAfterSeconds));
      return c.json({ error: 'rate_limited' } satisfies ApiErrorBody, 429);
    }

    bucket.count += 1;
    await next();
  });
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npm test -w @oc/api -- src/middleware/rateLimit.test.ts`
Expected:
```
 ✓ src/middleware/rateLimit.test.ts (4 tests)
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

- [ ] **Step 5: 型別檢查**

Run: `npm run typecheck -w @oc/api`
Expected: 無錯誤，exit code 0。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/middleware/rateLimit.ts apps/api/src/middleware/rateLimit.test.ts
git commit -m "feat(api): add per-key fixed-window rate limiter"
```

---

### Task 6: `createApp` 骨架：`/health` 與 CORS

**Files:**
- Create: `apps/api/src/test/helpers.ts`
- Create: `apps/api/src/app.ts`
- Test: `apps/api/src/app.health.test.ts`

- [ ] **Step 1: 建立測試共用工具 `apps/api/src/test/helpers.ts`**

```ts
import { vi } from 'vitest';
import { createApp } from '../app';
import type { Transcriber } from '../transcriber/types';

export const TEST_KEY = 'test-key-1';
export const OTHER_KEY = 'test-key-2';
export const ALLOWED_ORIGIN = 'http://localhost:5173';
export const DENIED_ORIGIN = 'https://evil.example.com';

export function createFakeTranscriber(result: string | Error = '你好') {
  return {
    transcribe: vi.fn<Transcriber['transcribe']>(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

export type FakeTranscriber = ReturnType<typeof createFakeTranscriber>;

export function createTestApp(opts: { transcriber?: FakeTranscriber; now?: () => number } = {}) {
  const transcriber = opts.transcriber ?? createFakeTranscriber();
  const app = createApp({
    transcriber,
    accessKeys: [TEST_KEY, OTHER_KEY],
    allowedOrigins: [ALLOWED_ORIGIN, 'app://bundle'],
    now: opts.now ?? Date.now,
  });
  return { app, transcriber };
}

export function audioFile(bytes = 1024, name = 'segment-1.webm', type = 'audio/webm'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** 建立 /transcribe 的 multipart 表單；欄位傳 null 代表不放這個欄位。 */
export function transcribeForm(
  fields: { audio?: File | string | null; seq?: string | null; prompt?: string } = {},
): FormData {
  const form = new FormData();
  const { audio = audioFile(), seq = '1', prompt } = fields;
  if (audio !== null) form.set('audio', audio);
  if (seq !== null) form.set('seq', seq);
  if (prompt !== undefined) form.set('prompt', prompt);
  return form;
}

export function postTranscribe(
  app: ReturnType<typeof createApp>,
  form: FormData,
  headers: Record<string, string> = { Authorization: `Bearer ${TEST_KEY}` },
) {
  return app.request('/transcribe', { method: 'POST', body: form, headers });
}
```

說明：`vi.fn<Transcriber['transcribe']>(...)` 是 Vitest 2+ 的泛型寫法（型別參數為整個函式型別）；`mock.calls[0][0]` 會被推論為 `TranscribeInput`。

- [ ] **Step 2: 寫失敗的測試 `apps/api/src/app.health.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { ALLOWED_ORIGIN, DENIED_ORIGIN, createTestApp } from './test/helpers';

describe('GET /health', () => {
  it('returns { ok: true } without an Authorization header', async () => {
    const { app } = createTestApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('adds Access-Control-Allow-Origin for an allowed origin', async () => {
    const { app } = createTestApp();
    const res = await app.request('/health', { headers: { Origin: ALLOWED_ORIGIN } });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
  });
});

describe('CORS preflight', () => {
  const preflight = (origin: string) => ({
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });

  it('allows a configured origin with Authorization and Retry-After exposed', async () => {
    const { app } = createTestApp();
    const res = await app.request('/transcribe', preflight(ALLOWED_ORIGIN));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');
  });

  it('allows the Electron app:// origin', async () => {
    const { app } = createTestApp();
    const res = await app.request('/transcribe', preflight('app://bundle'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('app://bundle');
  });

  it('omits Access-Control-Allow-Origin for an unknown origin', async () => {
    const { app } = createTestApp();
    const res = await app.request('/transcribe', preflight(DENIED_ORIGIN));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
```

- [ ] **Step 3: 執行測試確認失敗**

Run: `npm test -w @oc/api -- src/app.health.test.ts`
Expected: FAIL，`Error: Cannot find module '../app' imported from '.../src/test/helpers.ts'`，`Tests  no tests`。

- [ ] **Step 4: 最小實作 `apps/api/src/app.ts`**

```ts
import type { HealthResponse } from '@oc/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AuthEnv } from './middleware/auth';
import type { Transcriber } from './transcriber/types';

export interface AppDeps {
  transcriber: Transcriber;
  accessKeys: string[];
  allowedOrigins: string[];
  now?: () => number;
}

export function createApp({ allowedOrigins }: AppDeps) {
  const app = new Hono<AuthEnv>();

  // CORS 必須最先執行：預檢請求不帶 Authorization，且 401/413/429 回應也要有 CORS 標頭。
  app.use(
    '*',
    cors({
      origin: allowedOrigins,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      exposeHeaders: ['Retry-After'],
      maxAge: 600,
    }),
  );

  app.get('/health', (c) => c.json({ ok: true } satisfies HealthResponse));

  return app;
}
```

說明：`cors({ origin: string[] })` 對不在清單內的來源不送 `Access-Control-Allow-Origin`，瀏覽器即拒絕；預檢一律回 204。`exposeHeaders: ['Retry-After']` 是必要的——`Retry-After` 不是 CORS 安全清單內的回應標頭，不公開的話 M3b 的 `fetch` 讀不到。

- [ ] **Step 5: 執行測試確認通過**

Run: `npm test -w @oc/api -- src/app.health.test.ts`
Expected:
```
 ✓ src/app.health.test.ts (5 tests)
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

- [ ] **Step 6: 型別檢查**

Run: `npm run typecheck -w @oc/api`
Expected: 無錯誤，exit code 0。

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/app.health.test.ts apps/api/src/test/helpers.ts
git commit -m "feat(api): add createApp with /health and CORS"
```

---

### Task 7: `POST /transcribe`：金鑰驗證、轉寫、簡轉繁

**Files:**
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/app.transcribe.test.ts`

- [ ] **Step 1: 寫失敗的測試 `apps/api/src/app.transcribe.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ORIGIN,
  OTHER_KEY,
  audioFile,
  createFakeTranscriber,
  createTestApp,
  postTranscribe,
  transcribeForm,
} from './test/helpers';

describe('POST /transcribe auth', () => {
  it('returns 401 when Authorization is missing', async () => {
    const { app, transcriber } = createTestApp();
    const res = await postTranscribe(app, transcribeForm(), {});
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  it('returns 401 for a wrong key', async () => {
    const { app } = createTestApp();
    const res = await postTranscribe(app, transcribeForm(), { Authorization: 'Bearer nope' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('keeps CORS headers on a 401 so the browser can read the status', async () => {
    const { app } = createTestApp();
    const res = await postTranscribe(app, transcribeForm(), { Origin: ALLOWED_ORIGIN });
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
  });
});

describe('POST /transcribe success', () => {
  it('returns seq and simplified-to-traditional trimmed text', async () => {
    const transcriber = createFakeTranscriber('  这是简体中文，后来我们去开会。 \n');
    const { app } = createTestApp({ transcriber });
    const audio = audioFile(2048);

    const res = await postTranscribe(app, transcribeForm({ audio, seq: '3', prompt: '上一段' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ seq: 3, text: '這是簡體中文，後來我們去開會。' });
    expect(transcriber.transcribe).toHaveBeenCalledTimes(1);
    const [input] = transcriber.transcribe.mock.calls[0]!;
    expect(input.prompt).toBe('上一段');
    expect(input.file).toBeInstanceOf(File);
    expect(input.file.size).toBe(2048);
    expect(input.file.name).toBe('segment-1.webm');
  });

  it('defaults a missing prompt to an empty string', async () => {
    const { app, transcriber } = createTestApp();
    const res = await postTranscribe(app, transcribeForm({ seq: '1' }));
    expect(res.status).toBe(200);
    expect(transcriber.transcribe.mock.calls[0]![0].prompt).toBe('');
  });

  it('returns an empty string when the model hears nothing', async () => {
    const { app } = createTestApp({ transcriber: createFakeTranscriber('   ') });
    const res = await postTranscribe(app, transcribeForm({ seq: '7' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ seq: 7, text: '' });
  });

  it('accepts every configured access key', async () => {
    const { app } = createTestApp();
    const res = await postTranscribe(app, transcribeForm(), {
      Authorization: `Bearer ${OTHER_KEY}`,
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm test -w @oc/api -- src/app.transcribe.test.ts`
Expected: FAIL，7 個測試全部失敗：3 個 `AssertionError: expected 404 to be 401`、4 個 `AssertionError: expected 404 to be 200`（路由尚未存在）。`Tests  7 failed (7)`。

- [ ] **Step 3: 實作——以下列完整內容取代 `apps/api/src/app.ts`**

```ts
import type { HealthResponse, TranscribeResponse } from '@oc/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bearerAuth, type AuthEnv } from './middleware/auth';
import { toTraditional } from './text/toTraditional';
import type { Transcriber } from './transcriber/types';

export interface AppDeps {
  transcriber: Transcriber;
  accessKeys: string[];
  allowedOrigins: string[];
  now?: () => number;
}

export function createApp({ transcriber, accessKeys, allowedOrigins }: AppDeps) {
  const app = new Hono<AuthEnv>();

  // CORS 必須最先執行：預檢請求不帶 Authorization，且 401/413/429 回應也要有 CORS 標頭。
  app.use(
    '*',
    cors({
      origin: allowedOrigins,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      exposeHeaders: ['Retry-After'],
      maxAge: 600,
    }),
  );

  app.get('/health', (c) => c.json({ ok: true } satisfies HealthResponse));

  app.post('/transcribe', bearerAuth(accessKeys), async (c) => {
    const body = await c.req.parseBody();
    const audio = body['audio'] as File;
    const seq = Number(body['seq']);
    const prompt = typeof body['prompt'] === 'string' ? body['prompt'] : '';

    const rawText = await transcriber.transcribe({ file: audio, prompt });
    return c.json({ seq, text: toTraditional(rawText.trim()) } satisfies TranscribeResponse, 200);
  });

  return app;
}
```

說明：這一步刻意不做欄位驗證與大小限制（Task 8 補上）。401 回應能帶 CORS 標頭，是因為 Hono 在中介層回傳新 Response 時會把先前設在 `c.res` 上的標頭合併過去。

- [ ] **Step 4: 執行測試確認通過**

Run: `npm test -w @oc/api -- src/app.transcribe.test.ts src/app.health.test.ts`
Expected:
```
 ✓ src/app.health.test.ts (5 tests)
 ✓ src/app.transcribe.test.ts (7 tests)
 Test Files  2 passed (2)
      Tests  12 passed (12)
```

- [ ] **Step 5: 型別檢查**

Run: `npm run typecheck -w @oc/api`
Expected: 無錯誤，exit code 0。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/app.transcribe.test.ts
git commit -m "feat(api): add POST /transcribe with auth and traditional output"
```

---

### Task 8: 欄位驗證（400）與 5MB 上限（413）

**Files:**
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/app.validation.test.ts`

- [ ] **Step 1: 寫失敗的測試 `apps/api/src/app.validation.test.ts`**

```ts
import { MAX_AUDIO_BYTES } from '@oc/shared';
import { describe, expect, it } from 'vitest';
import { MULTIPART_OVERHEAD_BYTES } from './app';
import { TEST_KEY, audioFile, createTestApp, postTranscribe, transcribeForm } from './test/helpers';

describe('POST /transcribe validation', () => {
  it.each([
    ['missing audio', { audio: null }],
    ['audio sent as text', { audio: 'not a file' }],
    ['empty audio file', { audio: audioFile(0) }],
    ['missing seq', { seq: null }],
    ['seq zero', { seq: '0' }],
    ['negative seq', { seq: '-1' }],
    ['decimal seq', { seq: '1.5' }],
    ['non-numeric seq', { seq: 'abc' }],
  ] as const)('returns 400 for %s', async (_label, fields) => {
    const { app, transcriber } = createTestApp();
    const res = await postTranscribe(app, transcribeForm(fields));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_request' });
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  it('returns 400 for a body that is not multipart', async () => {
    const { app } = createTestApp();
    const res = await app.request('/transcribe', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ seq: 1 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_request' });
  });
});

describe('POST /transcribe size limit', () => {
  it('accepts audio of exactly MAX_AUDIO_BYTES', async () => {
    const { app } = createTestApp();
    const res = await postTranscribe(app, transcribeForm({ audio: audioFile(MAX_AUDIO_BYTES) }));
    expect(res.status).toBe(200);
  });

  it('returns 413 when the audio is one byte over MAX_AUDIO_BYTES', async () => {
    const { app, transcriber } = createTestApp();
    const res = await postTranscribe(
      app,
      transcribeForm({ audio: audioFile(MAX_AUDIO_BYTES + 1) }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large' });
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  it('returns 413 for a multipart request far over the limit', async () => {
    const { app, transcriber } = createTestApp();
    const huge = audioFile(MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES + 1);
    const res = await postTranscribe(app, transcribeForm({ audio: huge }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large' });
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  it('rejects an oversized body in bodyLimit before parsing', async () => {
    // octet-stream 不會被 parseBody 解析：少了 bodyLimit，handler 只會回 400（缺 audio），
    // 所以只有 bodyLimit 能讓這個請求得到 413。app.request() 不帶 Content-Length，走的是邊讀邊計數的路徑。
    const { app, transcriber } = createTestApp();
    const res = await app.request('/transcribe', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_KEY}`, 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES + 1),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large' });
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm test -w @oc/api -- src/app.validation.test.ts`
Expected: FAIL，`Tests  12 failed | 1 passed (13)`。9 個 400 測試出現 `expected 200 to be 400`，3 個 413 測試出現 `expected 200 to be 413`；只有 `accepts audio of exactly MAX_AUDIO_BYTES` 通過。（`MULTIPART_OVERHEAD_BYTES` 尚未匯出，執行期為 `undefined`，`undefined + 1` 為 `NaN`，`new Uint8Array(NaN)` 是空陣列——octet-stream 測試仍會因 Task 7 的 handler 回 200 而失敗；此時 `npm run typecheck` 也會報 `TS2305`，屬預期。）

- [ ] **Step 3: 實作——以下列完整內容取代 `apps/api/src/app.ts`**

```ts
import {
  MAX_AUDIO_BYTES,
  type ApiErrorBody,
  type HealthResponse,
  type TranscribeResponse,
} from '@oc/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { bearerAuth, type AuthEnv } from './middleware/auth';
import { toTraditional } from './text/toTraditional';
import type { Transcriber } from './transcriber/types';

export interface AppDeps {
  transcriber: Transcriber;
  accessKeys: string[];
  allowedOrigins: string[];
  now?: () => number;
}

/** multipart 邊界、seq、prompt 等欄位的額外空間；音訊本身另以 MAX_AUDIO_BYTES 檢查。 */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const SEQ_PATTERN = /^[1-9]\d*$/;

export function createApp({ transcriber, accessKeys, allowedOrigins }: AppDeps) {
  const app = new Hono<AuthEnv>();

  // CORS 必須最先執行：預檢請求不帶 Authorization，且 401/413/429 回應也要有 CORS 標頭。
  app.use(
    '*',
    cors({
      origin: allowedOrigins,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      exposeHeaders: ['Retry-After'],
      maxAge: 600,
    }),
  );

  app.get('/health', (c) => c.json({ ok: true } satisfies HealthResponse));

  app.post(
    '/transcribe',
    bearerAuth(accessKeys),
    bodyLimit({
      maxSize: MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES,
      onError: (c) => c.json({ error: 'payload_too_large' } satisfies ApiErrorBody, 413),
    }),
    async (c) => {
      let body: Record<string, string | File>;
      try {
        body = await c.req.parseBody();
      } catch {
        return c.json({ error: 'bad_request' } satisfies ApiErrorBody, 400);
      }

      const audio = body['audio'];
      const rawSeq = body['seq'];
      const prompt = body['prompt'] ?? '';

      if (!(audio instanceof File) || audio.size === 0) {
        return c.json({ error: 'bad_request' } satisfies ApiErrorBody, 400);
      }
      if (audio.size > MAX_AUDIO_BYTES) {
        return c.json({ error: 'payload_too_large' } satisfies ApiErrorBody, 413);
      }
      if (typeof rawSeq !== 'string' || !SEQ_PATTERN.test(rawSeq)) {
        return c.json({ error: 'bad_request' } satisfies ApiErrorBody, 400);
      }
      const seq = Number(rawSeq);
      if (!Number.isSafeInteger(seq) || typeof prompt !== 'string') {
        return c.json({ error: 'bad_request' } satisfies ApiErrorBody, 400);
      }

      const rawText = await transcriber.transcribe({ file: audio, prompt });
      return c.json({ seq, text: toTraditional(rawText.trim()) } satisfies TranscribeResponse, 200);
    },
  );

  return app;
}
```

說明：兩層大小檢查——`bodyLimit` 依 `Content-Length`（或在沒有時邊讀邊計數）擋掉遠超上限的請求，避免整包讀進記憶體；解析後再以 `audio.size > MAX_AUDIO_BYTES` 精確判斷音訊本身。`parseBody()` 對非 multipart／urlencoded 的 Content-Type 回傳 `{}`，因此 JSON body 會落在「缺 audio」而回 400。兩層各有專屬測試：`returns 413 when the audio is one byte over MAX_AUDIO_BYTES` 只有 handler 的檢查能擋（整包仍在 `bodyLimit` 上限內）；`rejects an oversized body in bodyLimit before parsing` 只有 `bodyLimit` 能擋（handler 不解析 octet-stream，少了 `bodyLimit` 會回 400）。

- [ ] **Step 4: 執行測試確認通過**

Run: `npm test -w @oc/api -- src/app.validation.test.ts src/app.transcribe.test.ts src/app.health.test.ts`
Expected:
```
 ✓ src/app.health.test.ts (5 tests)
 ✓ src/app.transcribe.test.ts (7 tests)
 ✓ src/app.validation.test.ts (13 tests)
 Test Files  3 passed (3)
      Tests  25 passed (25)
```

- [ ] **Step 5: 型別檢查**

Run: `npm run typecheck -w @oc/api`
Expected: 無錯誤，exit code 0。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/app.validation.test.ts
git commit -m "feat(api): validate transcribe fields and enforce 5MB limit"
```

---

### Task 9: 限流 429（`Retry-After`）、上游錯誤 502 與 JSON 404／500 後援

**Files:**
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/app.limits.test.ts`

- [ ] **Step 1: 寫失敗的測試 `apps/api/src/app.limits.test.ts`**

```ts
import { MAX_AUDIO_BYTES, RATE_LIMIT_PER_MINUTE } from '@oc/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MULTIPART_OVERHEAD_BYTES } from './app';
import {
  ALLOWED_ORIGIN,
  OTHER_KEY,
  TEST_KEY,
  createFakeTranscriber,
  createTestApp,
  postTranscribe,
  transcribeForm,
} from './test/helpers';
import type { Transcriber } from './transcriber/types';

afterEach(() => {
  vi.restoreAllMocks();
});

/** 超過 bodyLimit 上限、且 handler 不會解析的原始 body：只有 bodyLimit 會回 413。 */
function postOversizedRaw(app: ReturnType<typeof createTestApp>['app']) {
  return app.request('/transcribe', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TEST_KEY}`, 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES + 1),
  });
}

describe('POST /transcribe rate limit', () => {
  it('returns 429 with Retry-After after RATE_LIMIT_PER_MINUTE requests per key', async () => {
    let clock = 5_000_000;
    const { app } = createTestApp({ now: () => clock });

    for (let i = 1; i <= RATE_LIMIT_PER_MINUTE; i++) {
      const ok = await postTranscribe(app, transcribeForm({ seq: String(i) }));
      expect(ok.status).toBe(200);
    }

    clock += 15_000;
    const limited = await postTranscribe(app, transcribeForm({ seq: '61' }), {
      Authorization: `Bearer ${TEST_KEY}`,
      Origin: ALLOWED_ORIGIN,
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    expect(limited.headers.get('Retry-After')).toBe('45');
    expect(limited.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(limited.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');

    const otherKey = await postTranscribe(app, transcribeForm(), {
      Authorization: `Bearer ${OTHER_KEY}`,
    });
    expect(otherKey.status).toBe(200);

    clock += 45_000;
    const afterWindow = await postTranscribe(app, transcribeForm({ seq: '61' }));
    expect(afterWindow.status).toBe(200);
  });

  it('checks the rate limit before bodyLimit reads an oversized body', async () => {
    const { app } = createTestApp({ now: () => 7_000_000 });
    for (let i = 1; i <= RATE_LIMIT_PER_MINUTE; i++) {
      const ok = await postTranscribe(app, transcribeForm({ seq: String(i) }));
      expect(ok.status).toBe(200);
    }

    const res = await postOversizedRaw(app);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
  });
});

describe('POST /transcribe upstream failure', () => {
  it('returns 502 upstream_error when the transcriber throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app } = createTestApp({
      transcriber: createFakeTranscriber(new Error('OpenAI 500')),
    });

    const res = await postTranscribe(app, transcribeForm());

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream_error' });
    expect(consoleError).toHaveBeenCalledWith('[transcribe] upstream error:', 'OpenAI 500');
  });
});

describe('JSON fallbacks', () => {
  it('answers unknown paths and methods with a JSON 404 that keeps CORS headers', async () => {
    const { app } = createTestApp();
    for (const [method, path] of [
      ['GET', '/nope'],
      ['GET', '/transcribe'],
    ] as const) {
      const label = `${method} ${path}`;
      const res = await app.request(path, { method, headers: { Origin: ALLOWED_ORIGIN } });
      expect(res.status, label).toBe(404);
      expect(res.headers.get('Content-Type'), label).toMatch(/^application\/json/);
      expect(await res.json(), label).toEqual({ error: 'bad_request' });
      expect(res.headers.get('Access-Control-Allow-Origin'), label).toBe(ALLOWED_ORIGIN);
    }
  });

  it('answers an unexpected error with a JSON 500', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 回傳非字串讓 handler 的 rawText.trim() 丟 TypeError——發生在轉寫的 try/catch 之外。
    const transcriber = {
      transcribe: vi.fn<Transcriber['transcribe']>(async () => undefined as unknown as string),
    };
    const { app } = createTestApp({ transcriber });

    const res = await postTranscribe(app, transcribeForm());

    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Type')).toMatch(/^application\/json/);
    expect(await res.json()).toEqual({ error: 'upstream_error' });
    expect(consoleError).toHaveBeenCalledWith('[api] unhandled error:', expect.any(String));
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm test -w @oc/api -- src/app.limits.test.ts`
Expected: FAIL，`Tests  5 failed (5)`：
- `AssertionError: expected 200 to be 429`（尚未限流）
- `AssertionError: expected 413 to be 429`（沒有 rateLimit，`bodyLimit` 先回 413）
- `AssertionError: expected 500 to be 502`（轉寫錯誤落到 Hono 預設錯誤處理）
- `GET /nope: expected 'text/plain; charset=UTF-8' to match /^application\/json/`（Hono 預設 404 是純文字）
- `expected 'text/plain; charset=UTF-8' to match /^application\/json/`（Hono 預設 500 是純文字）

- [ ] **Step 3: 實作——以下列完整內容取代 `apps/api/src/app.ts`（最終版）**

```ts
import {
  MAX_AUDIO_BYTES,
  RATE_LIMIT_PER_MINUTE,
  type ApiErrorBody,
  type HealthResponse,
  type TranscribeResponse,
} from '@oc/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { bearerAuth, type AuthEnv } from './middleware/auth';
import { rateLimit } from './middleware/rateLimit';
import { toTraditional } from './text/toTraditional';
import type { Transcriber } from './transcriber/types';

export interface AppDeps {
  transcriber: Transcriber;
  accessKeys: string[];
  allowedOrigins: string[];
  now?: () => number;
}

/** multipart 邊界、seq、prompt 等欄位的額外空間；音訊本身另以 MAX_AUDIO_BYTES 檢查。 */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const RATE_LIMIT_WINDOW_MS = 60_000;
const SEQ_PATTERN = /^[1-9]\d*$/;

export function createApp({ transcriber, accessKeys, allowedOrigins, now = Date.now }: AppDeps) {
  const app = new Hono<AuthEnv>();

  // CORS 必須最先執行：預檢請求不帶 Authorization，且 401/413/429 回應也要有 CORS 標頭。
  app.use(
    '*',
    cors({
      origin: allowedOrigins,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      exposeHeaders: ['Retry-After'],
      maxAge: 600,
    }),
  );

  app.get('/health', (c) => c.json({ ok: true } satisfies HealthResponse));

  app.post(
    '/transcribe',
    bearerAuth(accessKeys),
    rateLimit({ limit: RATE_LIMIT_PER_MINUTE, windowMs: RATE_LIMIT_WINDOW_MS, now }),
    bodyLimit({
      maxSize: MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES,
      onError: (c) => c.json({ error: 'payload_too_large' } satisfies ApiErrorBody, 413),
    }),
    async (c) => {
      let body: Record<string, string | File>;
      try {
        body = await c.req.parseBody();
      } catch {
        return c.json({ error: 'bad_request' } satisfies ApiErrorBody, 400);
      }

      const audio = body['audio'];
      const rawSeq = body['seq'];
      const prompt = body['prompt'] ?? '';

      if (!(audio instanceof File) || audio.size === 0) {
        return c.json({ error: 'bad_request' } satisfies ApiErrorBody, 400);
      }
      if (audio.size > MAX_AUDIO_BYTES) {
        return c.json({ error: 'payload_too_large' } satisfies ApiErrorBody, 413);
      }
      if (typeof rawSeq !== 'string' || !SEQ_PATTERN.test(rawSeq)) {
        return c.json({ error: 'bad_request' } satisfies ApiErrorBody, 400);
      }
      const seq = Number(rawSeq);
      if (!Number.isSafeInteger(seq) || typeof prompt !== 'string') {
        return c.json({ error: 'bad_request' } satisfies ApiErrorBody, 400);
      }

      let rawText: string;
      try {
        rawText = await transcriber.transcribe({ file: audio, prompt });
      } catch (err) {
        // 只記錄錯誤訊息，不記錄金鑰或音訊內容。
        console.error('[transcribe] upstream error:', err instanceof Error ? err.message : err);
        return c.json({ error: 'upstream_error' } satisfies ApiErrorBody, 502);
      }

      return c.json({ seq, text: toTraditional(rawText.trim()) } satisfies TranscribeResponse, 200);
    },
  );

  // 未知路徑或方法（例如 GET /transcribe、多了路徑前綴的後端網址）也回 JSON，M3b 才能一律解析錯誤 body。
  app.notFound((c) => c.json({ error: 'bad_request' } satisfies ApiErrorBody, 404));

  // 中介層與 handler 沒接住的例外（例如 toTraditional、parseBody 內部錯誤）回 JSON 500；只記錄訊息，不記錄金鑰或音訊。
  app.onError((err, c) => {
    console.error('[api] unhandled error:', err instanceof Error ? err.message : String(err));
    return c.json({ error: 'upstream_error' } satisfies ApiErrorBody, 500);
  });

  return app;
}
```

說明：`rateLimit` 放在 `bodyLimit` 之前，被限流的請求不會讀取 5MB 的 body（`checks the rate limit before bodyLimit reads an oversized body` 鎖住這個順序）。中介層順序即契約要求的 CORS → auth → rateLimit → body limit。`ApiErrorCode` 沒有 `not_found`／`internal` 類別（契約固定），所以 404 用 `bad_request`、未預期 500 用 `upstream_error`；依契約，M3b 的 `withRetry` 對 ≥ 500 會重試，未預期 500 因此與上游 502 同樣處理。`notFound`／`onError` 產生的回應同樣帶 CORS 標頭（cors 中介層先在 `c.res` 設好標頭，Hono 換成新回應時會合併）。

- [ ] **Step 4: 執行整個 api 測試套件確認通過**

Run: `npm test -w @oc/api`
Expected:
```
 ✓ src/config.test.ts (5 tests)
 ✓ src/middleware/auth.test.ts (3 tests)
 ✓ src/middleware/rateLimit.test.ts (4 tests)
 ✓ src/text/toTraditional.test.ts (2 tests)
 ✓ src/transcriber/openaiTranscriber.test.ts (5 tests)
 ✓ src/app.health.test.ts (5 tests)
 ✓ src/app.transcribe.test.ts (7 tests)
 ✓ src/app.limits.test.ts (5 tests)
 ✓ src/app.validation.test.ts (13 tests)
 Test Files  9 passed (9)
      Tests  49 passed (49)
```
（檔案列出順序可能不同。）

- [ ] **Step 5: 型別檢查**

Run: `npm run typecheck -w @oc/api`
Expected: 無錯誤，exit code 0。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/app.limits.test.ts
git commit -m "feat(api): rate-limit transcribe, map upstream errors to 502, add JSON 404/500"
```

---

### Task 10: `server.ts`、`.env.example` 與本機冒煙測試

**Files:**
- Create: `apps/api/src/server.ts`
- Create: `apps/api/.env.example`

`server.ts` 只是把 `loadConfig`、`createOpenAITranscriber`、`createApp` 接起來交給 `@hono/node-server`，三者都已有單元測試；這裡用「實際啟動 + curl」驗證接線。

- [ ] **Step 1: 先確認沒有入口時無法啟動（失敗基準）**

Run: `npm start -w @oc/api`
Expected: 失敗，tsx 回報找不到 `src/server.ts`（`ERR_MODULE_NOT_FOUND` 或 `Cannot find module ...apps\api\src\server.ts`），exit code 非 0。

- [ ] **Step 2: 建立 `apps/api/src/server.ts`**

```ts
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { createOpenAITranscriber } from './transcriber/openaiTranscriber';

const config = loadConfig(process.env);

const app = createApp({
  transcriber: createOpenAITranscriber(config.openaiApiKey),
  accessKeys: config.accessKeys,
  allowedOrigins: config.allowedOrigins,
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`open-copilot api listening on http://localhost:${info.port}`);
});

// Docker 中 node 是 PID 1，不處理 SIGTERM 的話 docker stop 會等 10 秒後強制終止。
function shutdown(signal: string) {
  console.log(`${signal} received, closing server`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
```

- [ ] **Step 3: 建立 `apps/api/.env.example`**

```dotenv
# OpenAI API 金鑰（必填）。只放在後端，絕不放進前端。
OPENAI_API_KEY=sk-your-openai-key

# 存取金鑰（必填），逗號分隔；前端「設定」頁填的就是其中一把。
# 產生方式：node -e "console.log(crypto.randomUUID())"
ACCESS_KEYS=change-me-1,change-me-2

# CORS 允許來源（選填），逗號分隔；不填則用以下預設值。
# 正式環境請加上網頁正式網域，例如 https://notes.example.com
ALLOWED_ORIGINS=http://localhost:5173,https://localhost,capacitor://localhost,app://bundle

# 監聽埠（選填，預設 8787）
PORT=8787
```

- [ ] **Step 4: 型別檢查**

Run: `npm run typecheck -w @oc/api`
Expected: 無錯誤，exit code 0。

- [ ] **Step 5: 缺環境變數時應明確失敗**

Node 的 `--env-file`／`--env-file-if-exists` 不會覆寫行程中已存在的環境變數；若開發者的 shell 或 Windows 使用者環境變數已設定 `OPENAI_API_KEY`（OpenAI 使用者常見），它會蓋過 `.env`，本步驟也就測不到「缺變數」。因此在 subshell 內先 `unset` 四個變數再啟動（只影響這一次執行）。

Run（Git Bash，repo 根目錄）:
```bash
if test -f apps/api/.env; then echo "apps/api/.env exists - move it aside first"; false; else (unset OPENAI_API_KEY ACCESS_KEYS ALLOWED_ORIGINS PORT; npm start -w @oc/api); fi
```
Expected: 程序結束，輸出含 `Error: OPENAI_API_KEY is required`，exit code 非 0。
若印出 `apps/api/.env exists - move it aside first`：把既有檔案移到 repo 外（例如 `mv apps/api/.env ~/oc-api.env.bak`；不要留在 repo 內改名，否則 Task 12 的 `git status --short` 不會乾淨），重跑本步驟，Step 7 結束後再移回。

- [ ] **Step 6: 用假金鑰啟動並以 curl 驗證接線**

建立本機 `.env`（已被根目錄 `.gitignore` 的 `.env` 規則忽略）並啟動伺服器（Claude Code 請用 Bash 工具的 `run_in_background: true`；人工操作請在另一個終端機執行）。指令只在 `.env` 不存在、或是本步驟先前建立的假 `.env` 時才寫檔，絕不覆寫含真金鑰的檔案；同樣先 `unset` 繼承的變數，確保用的是 `sk-dummy` 而不是 shell 裡的真金鑰。冒煙測試一律用不帶 watch 的 `npm start`：`npm run dev` 的 `tsx watch` 父程序在子程序被終止後仍會留著，之後改檔會重新佔用 8787。
```bash
if test -f apps/api/.env && ! grep -qx 'OPENAI_API_KEY=sk-dummy' apps/api/.env; then echo "apps/api/.env exists - move it aside first"; false; else printf 'OPENAI_API_KEY=sk-dummy\nACCESS_KEYS=dev-key\n' > apps/api/.env && (unset OPENAI_API_KEY ACCESS_KEYS ALLOWED_ORIGINS PORT; npm start -w @oc/api); fi
```
Expected（伺服器輸出）: `open-copilot api listening on http://localhost:8787`。若印出 `apps/api/.env exists - move it aside first`，照 Step 5 的說明把檔案移到 repo 外後重跑。

在另一個 shell 執行：
```bash
curl -s --retry 10 --retry-all-errors --retry-delay 1 http://localhost:8787/health; echo
curl -s -X POST http://localhost:8787/transcribe; echo
curl -s -X POST http://localhost:8787/transcribe -H "Authorization: Bearer dev-key" -F "audio=@apps/api/package.json;type=audio/webm"; echo
curl -s -i -X OPTIONS http://localhost:8787/transcribe -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization" | grep -iE "^(HTTP|access-control-allow-origin)"
curl -s -X POST http://localhost:8787/transcribe -H "Authorization: Bearer dev-key" -F seq=1 -F "audio=@apps/api/.env.example;type=audio/webm"; echo
head -c 6000000 /dev/zero > oc-big.webm && curl -s -w " %{http_code}\n" -X POST http://localhost:8787/transcribe -H "Authorization: Bearer dev-key" -F seq=1 -F "audio=@oc-big.webm;type=audio/webm"; rm -f oc-big.webm
```
Expected（依序）:
```
{"ok":true}
{"error":"unauthorized"}
{"error":"bad_request"}
HTTP/1.1 204 No Content
access-control-allow-origin: http://localhost:5173
{"error":"upstream_error"}
{"error":"payload_too_large"} 413
```
第三行是缺 `seq` 的 400。第六行是 502：把 `.env.example` 當成假音訊送出，假 OpenAI 金鑰被 OpenAI 拒絕（離線時則是連線失敗），證明請求確實走到了轉寫服務；伺服器輸出應出現一行 `[transcribe] upstream error: ...`。最後一行用 6MB 的暫存檔驗證 413，檔案隨即刪除。（音訊檔一律用 repo 內的相對路徑：Git Bash 的 curl 不一定會轉換 `-F "audio=@/tmp/..."` 這種 MSYS 路徑。）

- [ ] **Step 7: 停止伺服器**

人工操作：在伺服器終端機按 Ctrl+C，應看到 `SIGINT received, closing server`。若以背景方式執行，用 PowerShell 依連接埠停止（Step 6 用的是不帶 watch 的 `npm start`，監聽 8787 的 node 子程序結束後，tsx 與 npm 會跟著結束），再確認連接埠已釋放：
```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
```
Expected: 第二個指令沒有任何輸出。若仍有輸出，表示還有程序在監聽 8787（例如誤用了 `npm run dev` 留下的 `tsx watch`），改用以下指令依命令列結束後再檢查一次：
```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'tsx' -and $_.CommandLine -match 'server\.ts' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```
若 Step 5 曾把原有的 `apps/api/.env` 移到 repo 外，現在刪掉假 `.env`（`rm apps/api/.env`）並把原檔移回。

然後確認 `.env` 會被 git 忽略（`git check-ignore` 只比對規則，檔案不存在也能檢查）：
```bash
git check-ignore -v apps/api/.env
```
Expected: 印出 `.gitignore:<行號>:.env	apps/api/.env`。

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/server.ts apps/api/.env.example
git commit -m "feat(api): add node server entry and env example"
```

---

### Task 11: Dockerfile、`.dockerignore` 與 README

**Files:**
- Create: `apps/api/Dockerfile`
- Create: `.dockerignore`
- Create: `apps/api/README.md`

- [ ] **Step 1: 建立 `apps/api/Dockerfile`**

```dockerfile
# Build context = repo root:  docker build -f apps/api/Dockerfile -t open-copilot-api .
FROM node:24-slim AS deps
WORKDIR /app
COPY . .
# Trim the workspace list to the API and its only workspace dependency, then install production deps.
# `npm ci --workspace @oc/api` is not a strict filter: it walks @oc/api's whole tree including
# devDependencies, so packages that are also another workspace's production deps leak into the image.
# The lockfile still pins every remaining version; `npm ci` would reject the edited workspace list.
RUN npm pkg delete workspaces \
 && npm pkg set 'workspaces[]=packages/shared' 'workspaces[]=apps/api' \
 && npm install --omit=dev --no-audit --no-fund

FROM node:24-slim
ENV NODE_ENV=production
ENV PORT=8787
WORKDIR /app
COPY --from=deps /app/package.json /app/package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared ./packages/shared
COPY --from=deps /app/apps/api ./apps/api
WORKDIR /app/apps/api
USER node
EXPOSE 8787
CMD ["node", "--import", "tsx", "src/server.ts"]
```

說明：第一階段複製整個 repo（由 `.dockerignore` 過濾），先用 `npm pkg` 把映像內根 `package.json` 的 `workspaces` 改成只有 `packages/shared` 與 `apps/api`，再 `npm install --omit=dev`：npm 依 lockfile 鎖定的版本，只安裝這兩個工作區的正式依賴（`tsx` 在 `@oc/api` 的 `dependencies` 內），並在映像內修剪 lockfile；repo 裡的 `package.json` 不受影響。不用 `npm ci --omit=dev --workspace @oc/api`：它會走訪 `@oc/api` 含 devDependencies 的整棵樹，`--omit=dev` 只移除被標成 dev 的節點，所以凡是同時出現在 `vitest`／`typescript`／`@types/node` 依賴樹中、又是其他工作區正式依賴的套件都會留在映像裡（以 npm 11.19、`node:24-slim` 實測：另一個工作區的 `ms` 經 `vitest → debug → ms` 被裝進映像）。根目錄的 devDependencies（M1 的 `@types/node`、`typescript`、`vitest`）因 `--omit=dev` 不會安裝。第二階段只帶 `node_modules`、`packages/shared`、`apps/api`。`node --import tsx` 直接在 Node 內載入 tsx（不另開子程序），SIGTERM 可直接送達 `server.ts`。

- [ ] **Step 2: 建立 repo 根目錄 `.dockerignore`**

```gitignore
**/node_modules
**/dist
**/coverage
**/.env
**/.env.*
!**/.env.example
**/*.test.ts
.git
playwright-report
test-results
apps/web/android
apps/desktop/release
docs
```

說明：`**/.env.*` 擋掉 `.env.local`、`.env.production` 這類變體——根目錄 `.gitignore` 只列 `.env`，這些檔案不會被 git 忽略，而第二階段 `COPY --from=deps /app/apps/api ./apps/api` 會複製整個目錄，沒擋的話裡面的真金鑰會被打包進映像。`!**/.env.example` 讓範例檔照常保留。

- [ ] **Step 3: 建立 `apps/api/README.md`**

````markdown
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
- 要換轉寫服務（Groq、Azure…）時，實作 `src/transcriber/types.ts` 的 `Transcriber` 介面並在 `src/server.ts` 換掉即可。
````

- [ ] **Step 4: 建置映像**

Run（repo 根目錄；需 Docker Desktop 執行中）:
```bash
docker build -f apps/api/Dockerfile -t open-copilot-api .
```
Expected: 結尾出現 `naming to docker.io/library/open-copilot-api:latest done`，exit code 0。較新的 npm 可能在安裝步驟印出 `npm warn install-scripts ... esbuild@... (postinstall: node install.js)`，可忽略：esbuild 經由 `@esbuild/linux-x64` 平台套件即可運作，Step 5 的冒煙測試會驗證 tsx 能執行。若本機沒有 Docker，**不得略過不提**：在任務回報中明寫「Docker 建置未驗證：本機無 Docker」。

- [ ] **Step 5: 執行容器冒煙測試**

先確認 Task 10 的本機伺服器已停止、8787 埠空出（PowerShell）：
```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
```
Expected: 沒有任何輸出（有輸出就照 Task 10 Step 7 停掉殘留程序）。

再執行（Git Bash）：
```bash
docker run -d --rm --name oc-api -p 8787:8787 -e OPENAI_API_KEY=sk-dummy -e ACCESS_KEYS=dev-key open-copilot-api
curl -s --retry 10 --retry-all-errors --retry-delay 1 http://localhost:8787/health; echo
curl -s -X POST http://localhost:8787/transcribe; echo
docker exec oc-api sh -c "ls /app/node_modules; echo ---; ls /app/node_modules/@oc"
docker stop oc-api
```
Expected:
```
{"ok":true}
{"error":"unauthorized"}
```
`ls /app/node_modules` 只有 `@oc/api` 的正式依賴樹：`@esbuild`、`@hono`、`@oc`、`esbuild`、`hono`、`openai`、`opencc-js`、`tsx`（依 tsx 版本可能另有 `get-tsconfig`、`resolve-pkg-maps`）；沒有 `react`、`@tiptap`、`docx`、`idb`、`lucide-react`、`@capacitor`、`electron`、`vitest`、`typescript`、`@types`。`---` 之後只有 `api` 與 `shared`。`docker stop` 在約 1 秒內完成（SIGTERM 有被處理）。

說明：必須用 `--retry-all-errors`。Docker Desktop 的連接埠代理在容器內程式尚未監聽時會先接受連線再回空回應（curl exit 52 `Empty reply from server`），`--retry-connrefused` 不會重試這種錯誤。

- [ ] **Step 6: Commit**

```bash
git add apps/api/Dockerfile .dockerignore apps/api/README.md
git commit -m "chore(api): add Dockerfile, dockerignore and README"
```

---

### Task 12: Verification

**Files:** 無新增；只執行檢查。若發現問題，修正後以 `fix(api): ...` 另行 commit。

- [ ] **Step 1: 後端完整測試**

Run: `npm test -w @oc/api`
Expected: `Test Files  9 passed (9)`、`Tests  49 passed (49)`，沒有 `failed`、沒有未處理的錯誤輸出。

- [ ] **Step 2: 後端型別檢查**

Run: `npm run typecheck -w @oc/api`
Expected: exit code 0、無 `error TS` 輸出。

- [ ] **Step 3: 共用套件與全 repo 未被破壞**

Run:
```bash
npm run typecheck -w @oc/shared --if-present
npm test
npm run typecheck
```
Expected: 三個指令 exit code 皆為 0；`npm test` 輸出中 `@oc/api` 區段為 `Tests  49 passed (49)`，且沒有任何工作區出現 `failed`。

- [ ] **Step 4: 契約對照**

Run:
```bash
grep -n "export function loadConfig(env: Record<string, string | undefined>): AppConfig" apps/api/src/config.ts
grep -n "transcribe(input: TranscribeInput): Promise<string>" apps/api/src/transcriber/types.ts
grep -n "export function createOpenAITranscriber(apiKey: string, client?: OpenAI): Transcriber" apps/api/src/transcriber/openaiTranscriber.ts
grep -n "export function toTraditional(text: string): string" apps/api/src/text/toTraditional.ts
grep -n "export function bearerAuth(accessKeys: string\[\])" apps/api/src/middleware/auth.ts
grep -n "export function rateLimit({ limit, windowMs, now = Date.now }: RateLimitOptions)" apps/api/src/middleware/rateLimit.ts
grep -n "export function createApp({ transcriber, accessKeys, allowedOrigins, now = Date.now }: AppDeps)" apps/api/src/app.ts
grep -nE "app\.(notFound|onError)\(" apps/api/src/app.ts
grep -nE "OPENAI_API_KEY|ACCESS_KEYS|ALLOWED_ORIGINS|PORT" apps/api/.env.example
grep -nF "opencc-js@^1.4" docs/superpowers/plans/2026-10-21-00-overview.md
test ! -e apps/api/src/types/opencc-js.d.ts && echo "no opencc-js d.ts (package ships its own types)"
```
Expected: 每個 `grep` 都至少有一行匹配；`app.(notFound|onError)` 列出兩行；`.env.example` 那一個列出四個變數；總覽那一個至少列出 §4 的 `toTraditional` 條目與 §6 第 6 點；最後一行印出 `no opencc-js d.ts (package ships its own types)`。

- [ ] **Step 5: 工作目錄乾淨、沒有秘密進版控**

Run:
```bash
git status --short
git ls-files apps/api | grep -E "(^|/)\.env(\.[^/]+)?$" | grep -v "\.env\.example$" || echo "no .env tracked"
```
Expected: `git status --short` 無輸出；第二個指令印出 `no .env tracked`（`.env.example` 以外的 `.env`、`.env.*` 都沒有進版控）。

- [ ] **Step 6: Docker（若 Task 11 已驗證可跳過，但需在回報中註明）**

Run:
```bash
docker build -f apps/api/Dockerfile -t open-copilot-api .
```
Expected: exit code 0。

- [ ] **Step 7: 人工檢查表（需真正的 OpenAI 金鑰；沒有就在回報中註明「未做真實轉寫驗證」）**

1. `apps/api/.env` 填入真正的 `OPENAI_API_KEY`、`ACCESS_KEYS=dev-key`，在 Git Bash 執行 `(unset OPENAI_API_KEY ACCESS_KEYS ALLOWED_ORIGINS PORT; npm start -w @oc/api)`（先清掉 shell 繼承的同名變數，確保用的是 `.env` 的值）。
2. 用手機或電腦錄一段 3–5 秒的中文（例如「今天下午三點開會，討論軟體上線」），存成 `.webm`、`.m4a` 或 `.mp3`。
3. `curl -s -X POST http://localhost:8787/transcribe -H "Authorization: Bearer dev-key" -F seq=1 -F "prompt=" -F "audio=@<檔案路徑>"`
   - [ ] 回應為 `{"seq":1,"text":"..."}`，`text` 全為繁體字（例如「開會」「上線」而非「开会」「上线」；`cn→tw` 只做字形轉換，「软件」會變成「軟件」而非「軟體」，屬預期）。
4. 限流（為避免 60 次真實計費，改用假 OpenAI 金鑰）：在伺服器終端機按 Ctrl+C 停止，把 `.env` 的 `OPENAI_API_KEY` 改成 `sk-dummy`，再以 `(unset OPENAI_API_KEY ACCESS_KEYS ALLOWED_ORIGINS PORT; npm start -w @oc/api)` 重啟（必須 `unset`：shell 裡若有真金鑰會蓋過 `.env`，下面 61 次請求就會真的送到 OpenAI 計費）。執行
   `for i in $(seq 1 61); do curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8787/transcribe -H "Authorization: Bearer dev-key" -F seq=$i -F "audio=@apps/api/.env.example;type=audio/webm"; done | sort | uniq -c`
   - [ ] 結果為 `60 502` 與 `1 429`。
   - [ ] 立刻再執行 `curl -s -D - -o /dev/null -X POST http://localhost:8787/transcribe -H "Authorization: Bearer dev-key" -F seq=1 -F "audio=@apps/api/.env.example" | grep -i retry-after`，看到 `Retry-After: <1–60 的整數>`。
5. 停止伺服器（Ctrl+C），確認看到 `SIGINT received, closing server`；把 `.env` 的金鑰改回需要的值。
