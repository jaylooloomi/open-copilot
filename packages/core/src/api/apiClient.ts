import type { ApiErrorCode, TranscribeResponse } from '@oc/shared';

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
}

export interface ApiClientOptions {
  baseUrl: string;
  accessKey: string;
  fetchImpl?: typeof fetch;
  /** Abort a request after this long and report it as a network error (status 0). */
  timeoutMs?: number;
}

export const REQUEST_TIMEOUT_MS = 30_000;

const API_ERROR_CODES: readonly string[] = [
  'unauthorized',
  'payload_too_large',
  'rate_limited',
  'bad_request',
  'upstream_error',
];

export function createApiClient({
  baseUrl,
  accessKey,
  // Looked up on every call so tests can stub the global fetch.
  fetchImpl = (input, init) => fetch(input, init),
  timeoutMs = REQUEST_TIMEOUT_MS,
}: ApiClientOptions): ApiClient {
  const root = baseUrl.trim().replace(/\/+$/, '');

  async function send(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(`${root}${path}`, { ...init, signal: controller.signal });
    } catch (cause) {
      throw new ApiError('Network error', 0, { cause });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async health() {
      try {
        const res = await send('/health', { method: 'GET' });
        if (!res.ok) return false;
        const body = await readJson(res);
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
      const res = await send('/transcribe', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessKey}` },
        body: form,
      });
      const body = await readJson(res);
      if (!res.ok) {
        const code =
          isRecord(body) && typeof body.error === 'string' && API_ERROR_CODES.includes(body.error)
            ? (body.error as ApiErrorCode)
            : undefined;
        throw new ApiError(`Request failed with status ${res.status}`, res.status, {
          code,
          retryAfterMs: parseRetryAfter(res.headers.get('Retry-After')),
        });
      }
      if (!isRecord(body) || typeof body.seq !== 'number' || typeof body.text !== 'string') {
        throw new ApiError('Invalid transcribe response', res.status);
      }
      return { seq: body.seq, text: body.text };
    },
  };
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
