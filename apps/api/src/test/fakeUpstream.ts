import { vi } from 'vitest';

/** 假上游收到的一次請求：網址、Authorization 與 multipart 欄位（檔案記成 file:<檔名>）。 */
export interface UpstreamCall {
  url: string;
  authorization: string | null;
  fields: Record<string, string>;
}

/**
 * 假的上游 fetch，注入真正的 OpenAI SDK client（ClientOptions.fetch）。
 * SDK 照常組 multipart、解析回應與錯誤，只是不連網。
 * 只處理 multipart 請求（其他 content-type 直接丟出清楚的錯誤）；signal 已中止時以中止原因拒絕。
 * `calls` 只記錄真正送到上游的 multipart 請求；要斷言「呼叫上游幾次」請用 `calls.length`，
 * 不要用 `fetch` 的呼叫次數。
 */
export function createFakeUpstream(respond: (call: UpstreamCall) => Response) {
  const calls: UpstreamCall[] = [];
  // OpenAI SDK 第一次看到新的 fetch 函式時，若它沒有 `Response` 屬性，會先用它送一次
  // `fetch('data:,')` 探測 FormData 支援（openai/internal/uploads.js 的 supportsFormData）。
  // 掛上全域 Response 讓 SDK 跳過這次探測，fetch 的呼叫次數才等於真正的上游請求數。
  const fetch = Object.assign(vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    // 像真的 fetch 一樣：signal 已中止就以中止原因拒絕，不記錄、不回應。
    if (request.signal.aborted) throw request.signal.reason;
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.startsWith('multipart/form-data')) {
      throw new Error(`createFakeUpstream only handles multipart requests, got "${contentType}"`);
    }
    const form = await request.formData();
    const fields: Record<string, string> = {};
    for (const [name, value] of form.entries()) {
      fields[name] = typeof value === 'string' ? value : `file:${value.name}`;
    }
    const call: UpstreamCall = {
      url: request.url,
      authorization: request.headers.get('authorization'),
      fields,
    };
    calls.push(call);
    return respond(call);
  }), { Response });
  return { fetch, calls };
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** 假 JSON 上游收到的一次請求：網址、方法、Authorization 與解析後的 JSON body。 */
export interface JsonUpstreamCall {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

/**
 * 假的上游 fetch，專門處理 JSON 請求（例如 chat completions），注入真正的 OpenAI SDK client。
 * 和 createFakeUpstream 一樣：signal 已中止時以中止原因拒絕；非 JSON 請求直接丟出清楚的錯誤；
 * `calls` 只記錄真正送到上游的請求。
 */
export function createFakeJsonUpstream(respond: (call: JsonUpstreamCall) => Response) {
  const calls: JsonUpstreamCall[] = [];
  // 掛上全域 Response 的理由同 createFakeUpstream：讓 SDK 跳過 FormData 探測。
  const fetch = Object.assign(vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.signal.aborted) throw request.signal.reason;
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.startsWith('application/json')) {
      throw new Error(`createFakeJsonUpstream only handles JSON requests, got "${contentType}"`);
    }
    const call: JsonUpstreamCall = {
      url: request.url,
      method: request.method,
      authorization: request.headers.get('authorization'),
      body: await request.json(),
    };
    calls.push(call);
    return respond(call);
  }), { Response });
  return { fetch, calls };
}

/** 一個成功的 chat completion 回應，只有一個 choice；content 可為 null（模型沒有輸出）。 */
export function chatCompletionResponse(content: string | null): Response {
  return jsonResponse(200, {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'test-model',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        logprobs: null,
        message: { role: 'assistant', content, refusal: null },
      },
    ],
  });
}

/**
 * 測試不可連網：把全域 fetch 換成會丟錯的假物件。在 beforeEach 呼叫，
 * afterEach 用 vi.unstubAllGlobals() 還原。沒注入假上游的 SDK client 會因此失敗，而不是打到真的 API。
 */
export function blockRealNetwork(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('tests must not reach the network');
    }),
  );
}
