import { MAX_AUDIO_BYTES } from '@oc/shared';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ORIGIN,
  OTHER_KEY,
  TEST_KEY,
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
    const { app, transcriber } = createTestApp();
    const res = await postTranscribe(app, transcribeForm(), { Authorization: 'Bearer nope' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  it('keeps CORS headers on a 401 so the browser can read the status', async () => {
    const { app } = createTestApp();
    const res = await postTranscribe(app, transcribeForm(), { Origin: ALLOWED_ORIGIN });
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
  });
});

describe('POST /transcribe CORS on errors', () => {
  it.each([
    ['400 bad_request', () => transcribeForm({ seq: null }), 400, 'bad_request'],
    [
      '413 payload_too_large',
      () => transcribeForm({ audio: audioFile(MAX_AUDIO_BYTES + 1) }),
      413,
      'payload_too_large',
    ],
  ] as const)('keeps CORS headers on a %s', async (_label, form, status, error) => {
    const { app, transcriber } = createTestApp();
    const res = await postTranscribe(app, form(), {
      Authorization: `Bearer ${TEST_KEY}`,
      Origin: ALLOWED_ORIGIN,
    });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(transcriber.transcribe).not.toHaveBeenCalled();
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
