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
    ['seq above MAX_SAFE_INTEGER', { seq: '9007199254740993' }],
    ['prompt sent as a file', { prompt: new File(['zh'], 'prompt.txt', { type: 'text/plain' }) }],
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
