import {
  AI_UPSTREAM_TIMEOUT_MS,
  type AiRequest,
  type AiSummaryResponse,
  type AiTodosResponse,
  type ApiErrorCode,
  type TranscribeResponse,
} from '@oc/shared';

/** A failed API call. `status` is the HTTP status, or 0 for a network error or timeout. */
export class ApiError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;
  readonly code?: ApiErrorCode;

  constructor(
    message: string,
    status: number,
    options: { retryAfterMs?: number; code?: ApiErrorCode; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ApiError';
    this.status = status;
    this.retryAfterMs = options.retryAfterMs;
    this.code = options.code;
  }
}

export interface TranscribeInput {
  audio: Blob;
  seq: number;
  prompt: string;
  filename: string;
}

export interface ApiClient {
  /** GET /health; true only for 200 `{ ok: true }`. Never throws. */
  health(): Promise<boolean>;
  /** POST /transcribe; rejects with ApiError. */
  transcribe(input: TranscribeInput): Promise<TranscribeResponse>;
  /** POST /ai/summary; rejects with ApiError (503 `ai_unavailable` when the backend has no Groq key). */
  summarize(input: AiRequest): Promise<AiSummaryResponse>;
  /** POST /ai/todos; rejects with ApiError like summarize(). */
  todos(input: AiRequest): Promise<AiTodosResponse>;
}

export interface ApiClientOptions {
  baseUrl: string;
  accessKey: string;
  fetchImpl?: typeof fetch;
  /** Abort a request after this long and report it as a network error (status 0). */
  timeoutMs?: number;
  /** The same, for the AI endpoints, whose LLM call takes much longer than a transcription. */
  aiTimeoutMs?: number;
}

export const REQUEST_TIMEOUT_MS = 30_000;
/**
 * The backend gives the LLM AI_UPSTREAM_TIMEOUT_MS and then answers with its own error; waiting
 * 15 s longer lets that answer arrive instead of a bare network error.
 */
export const AI_REQUEST_TIMEOUT_MS = AI_UPSTREAM_TIMEOUT_MS + 15_000;

// `Record` over the union makes the compiler flag a code added to or removed from @oc/shared.
const API_ERROR_CODE_SET: Record<ApiErrorCode, true> = {
  unauthorized: true,
  payload_too_large: true,
  rate_limited: true,
  bad_request: true,
  upstream_error: true,
  ai_unavailable: true,
};

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && Object.hasOwn(API_ERROR_CODE_SET, value);
}

export function createApiClient({
  baseUrl,
  accessKey,
  // Looked up on every call so tests can stub the global fetch.
  fetchImpl = (input, init) => fetch(input, init),
  timeoutMs = REQUEST_TIMEOUT_MS,
  aiTimeoutMs = AI_REQUEST_TIMEOUT_MS,
}: ApiClientOptions): ApiClient {
  const root = baseUrl.trim().replace(/\/+$/, '');

  /** Fetches and reads the JSON body under one deadline, so a stalled body also times out. */
  async function send(
    path: string,
    init: RequestInit,
    deadlineMs: number = timeoutMs,
  ): Promise<{ res: Response; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadlineMs);
    try {
      let res: Response;
      try {
        res = await fetchImpl(`${root}${path}`, { ...init, signal: controller.signal });
      } catch (cause) {
        throw new ApiError('Network error', 0, { cause });
      }
      const body = await readJson(res);
      if (controller.signal.aborted) throw new ApiError('Network error', 0);
      return { res, body };
    } finally {
      clearTimeout(timer);
    }
  }

  /** POSTs `{ title, text }` as JSON to an AI endpoint; resolves only for a 2xx response. */
  async function postAi(
    path: '/ai/summary' | '/ai/todos',
    { title, text }: AiRequest,
  ): Promise<{ res: Response; body: unknown }> {
    const result = await send(
      path,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, text }),
      },
      aiTimeoutMs,
    );
    if (!result.res.ok) throw responseError(result.res, result.body);
    return result;
  }

  return {
    async health() {
      try {
        const { res, body } = await send('/health', { method: 'GET' });
        if (!res.ok) return false;
        return isRecord(body) && body.ok === true;
      } catch {
        return false;
      }
    },

    async transcribe({ audio, seq, prompt, filename }) {
      const form = new FormData();
      form.append('audio', audio, filename);
      form.append('seq', String(seq));
      form.append('prompt', prompt);
      const { res, body } = await send('/transcribe', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessKey}` },
        body: form,
      });
      if (!res.ok) throw responseError(res, body);
      if (!isRecord(body) || typeof body.seq !== 'number' || typeof body.text !== 'string') {
        throw new ApiError('Invalid transcribe response', res.status);
      }
      return { seq: body.seq, text: body.text };
    },

    async summarize(input) {
      const { res, body } = await postAi('/ai/summary', input);
      if (!isRecord(body) || typeof body.summary !== 'string') {
        throw new ApiError('Invalid summary response', res.status);
      }
      return { summary: body.summary };
    },

    async todos(input) {
      const { res, body } = await postAi('/ai/todos', input);
      const items = isRecord(body) ? body.items : undefined;
      if (!Array.isArray(items) || !items.every((item): item is string => typeof item === 'string')) {
        throw new ApiError('Invalid todos response', res.status);
      }
      return { items };
    },
  };
}

/** The ApiError for a non-2xx response, with the server's error code and Retry-After. */
function responseError(res: Response, body: unknown): ApiError {
  const code = isRecord(body) && isApiErrorCode(body.error) ? body.error : undefined;
  return new ApiError(`Request failed with status ${res.status}`, res.status, {
    code,
    retryAfterMs: parseRetryAfter(res.headers.get('Retry-After')),
  });
}

/** `Retry-After` in ms: delta-seconds or an HTTP date; undefined when missing or unreadable. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    // Proxies and gateways may answer with HTML or plain text.
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
