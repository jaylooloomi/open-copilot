import { describe, expect, it } from 'vitest';
import { createFakeUpstream, jsonResponse } from './fakeUpstream';

describe('createFakeUpstream', () => {
  it('rejects with the abort reason when the request signal is already aborted', async () => {
    const upstream = createFakeUpstream(() => jsonResponse(200, { text: 'ok' }));
    const form = new FormData();
    form.append('model', 'whisper-1');
    const controller = new AbortController();
    controller.abort();

    await expect(
      upstream.fetch('https://upstream.test/v1/audio/transcriptions', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(upstream.calls).toHaveLength(0);
  });

  it('fails with a clear error for a request that is not multipart', async () => {
    const upstream = createFakeUpstream(() => jsonResponse(200, {}));

    await expect(
      upstream.fetch('https://upstream.test/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    ).rejects.toThrow(/only handles multipart/);
    expect(upstream.calls).toHaveLength(0);
  });
});
