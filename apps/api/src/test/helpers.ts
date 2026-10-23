import { vi } from 'vitest';
import type { NoteAssistant } from '../ai/types';
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

/** 假 AI 助理：summary／todos 傳 Error 時，對應的方法改成丟出這個錯誤。 */
export function createFakeAssistant(
  result: { summary?: string | Error; todos?: string[] | Error } = {},
) {
  const { summary = '• 重點摘要', todos = ['寄出報價單'] } = result;
  return {
    summarize: vi.fn<NoteAssistant['summarize']>(async () => {
      if (summary instanceof Error) throw summary;
      return summary;
    }),
    extractTodos: vi.fn<NoteAssistant['extractTodos']>(async () => {
      if (todos instanceof Error) throw todos;
      return todos;
    }),
  };
}

export type FakeAssistant = ReturnType<typeof createFakeAssistant>;

/** assistant 省略時用預設的假 AI 助理；傳 null 代表沒有 GROQ_API_KEY（/ai/* 回 503）。 */
export function createTestApp(
  opts: {
    transcriber?: FakeTranscriber;
    assistant?: NoteAssistant | null;
    now?: () => number;
  } = {},
) {
  const transcriber = opts.transcriber ?? createFakeTranscriber();
  const assistant = opts.assistant === undefined ? createFakeAssistant() : opts.assistant;
  const app = createApp({
    transcriber,
    assistant,
    accessKeys: [TEST_KEY, OTHER_KEY],
    allowedOrigins: [ALLOWED_ORIGIN, 'app://bundle'],
    now: opts.now ?? Date.now,
  });
  return { app, transcriber, assistant };
}

export function audioFile(bytes = 1024, name = 'segment-1.webm', type = 'audio/webm'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** 建立 /transcribe 的 multipart 表單；欄位傳 null 代表不放這個欄位。 */
export function transcribeForm(
  fields: { audio?: File | string | null; seq?: string | null; prompt?: File | string } = {},
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

export type AiPath = '/ai/summary' | '/ai/todos';

/** 以 JSON 送出 /ai/* 請求；body 是字串時原樣送出（用來測試不合法的 JSON）。 */
export function postAi(
  app: ReturnType<typeof createApp>,
  path: AiPath,
  body: unknown,
  headers: Record<string, string> = { Authorization: `Bearer ${TEST_KEY}` },
  init: { signal?: AbortSignal } = {},
) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: init.signal,
  });
}
