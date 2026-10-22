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
