import { MAX_AUDIO_BYTES } from '@oc/shared';
import { act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/apiClient';
import { CONFIGURED, createTestEditor, settle, setupRecorder } from '../test/recorderHarness';
import { createPendingQueue } from './pendingQueue';
import { RECORDER_MESSAGES } from './useRecorder';

type Ctx = Awaited<ReturnType<typeof setupRecorder>>;

const GAP_1 = '<span class="oc-gap" data-transcript-gap="gap-1">⚠ 第 1 段未轉寫・重試</span>';

/** Starts recording and pushes `count` segments through the fake recorder. */
async function recordSegments(ctx: Ctx, count: number) {
  await act(async () => {
    await ctx.result.current.start();
  });
  act(() => {
    for (let seq = 1; seq <= count; seq += 1) ctx.recorders[0].emit(seq);
  });
}

/** Stores audio for gap-1 of note n1, as an earlier recording would have. */
function keepAudioForGap1(ctx: Ctx) {
  return createPendingQueue(ctx.db).add({
    gapId: 'gap-1',
    noteId: 'n1',
    seq: 1,
    blob: new Blob(['x']),
    mimeType: 'audio/webm',
    prompt: '',
  });
}

/** Clicks the marker (retryGap) and waits until its request is out; the test answers it later. */
async function startRetry(ctx: Ctx, gapId: string) {
  let retried!: Promise<void>;
  act(() => {
    retried = ctx.result.current.retryGap(gapId);
  });
  await waitFor(() => expect(ctx.calls).toHaveLength(1));
  return { retried, call: ctx.calls[0] };
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('useRecorder: failures', () => {
  it('retries a failing segment 3 times, then inserts a gap and keeps the audio', async () => {
    const ctx = await setupRecorder();
    ctx.transcribe.mockImplementation(async (input) => {
      if (input.seq === 1) throw new ApiError('upstream', 502);
      return { seq: input.seq, text: '第二段' };
    });

    await recordSegments(ctx, 2);

    await waitFor(() => expect(ctx.editor.getHTML()).toBe(`<p>${GAP_1}第二段</p>`));
    expect(ctx.transcribe.mock.calls.filter(([input]) => input.seq === 1)).toHaveLength(4);
    expect(ctx.deps.sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
    expect(await createPendingQueue(ctx.db).get('gap-1')).toMatchObject({
      gapId: 'gap-1',
      noteId: 'n1',
      seq: 1,
      mimeType: 'audio/webm;codecs=opus',
      prompt: '',
    });
  });

  it('retryGap re-sends the kept audio and replaces the gap with the transcript', async () => {
    const ctx = await setupRecorder();
    ctx.transcribe.mockRejectedValue(new ApiError('down', 503));
    await recordSegments(ctx, 1);
    await waitFor(() => expect(ctx.editor.getHTML()).toBe(`<p>${GAP_1}</p>`));

    ctx.transcribe.mockReset();
    ctx.transcribe.mockResolvedValue({ seq: 1, text: '補上的文字' });
    await act(async () => {
      await ctx.result.current.retryGap('gap-1');
    });

    expect(ctx.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ seq: 1, prompt: '', filename: 'segment-1.webm' }),
    );
    expect(ctx.editor.getHTML()).toBe('<p>補上的文字</p>');
    expect(await createPendingQueue(ctx.db).get('gap-1')).toBeUndefined();
  });

  it('retryGap reads audio kept by an earlier page load from IndexedDB', async () => {
    const ctx = await setupRecorder({
      content: '<p>前<span class="oc-gap" data-transcript-gap="old">⚠ 第 4 段未轉寫・重試</span>後</p>',
    });
    await createPendingQueue(ctx.db).add({
      gapId: 'old',
      noteId: 'n1',
      seq: 4,
      blob: new Blob(['x']),
      mimeType: 'audio/mp4',
      prompt: '上文',
    });
    ctx.transcribe.mockResolvedValue({ seq: 4, text: '第四段' });

    await act(async () => {
      await ctx.result.current.retryGap('old');
    });

    expect(ctx.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ seq: 4, prompt: '上文', filename: 'segment-4.mp4' }),
    );
    expect(ctx.editor.getText()).toBe('前第四段後');
  });

  it('retryGap keeps the gap and says so when the retry fails too', async () => {
    const ctx = await setupRecorder();
    ctx.transcribe.mockRejectedValue(new ApiError('down', 500));
    await recordSegments(ctx, 1);
    await waitFor(() => expect(ctx.editor.getHTML()).toBe(`<p>${GAP_1}</p>`));

    await act(async () => {
      await ctx.result.current.retryGap('gap-1');
    });

    expect(ctx.result.current.error).toBe('重新轉寫失敗，請稍後再試');
    expect(ctx.editor.getHTML()).toBe(`<p>${GAP_1}</p>`);
    expect(await createPendingQueue(ctx.db).get('gap-1')).toBeDefined();
  });

  it('retryGap reports audio that is gone', async () => {
    const ctx = await setupRecorder();
    await act(async () => {
      await ctx.result.current.retryGap('unknown');
    });
    expect(ctx.result.current.error).toBe(RECORDER_MESSAGES.audioMissing);
    expect(ctx.transcribe).not.toHaveBeenCalled();
  });

  it('retryGap keeps the audio when another note is opened before the transcript arrives', async () => {
    const ctx = await setupRecorder({ content: `<p>${GAP_1}</p>` });
    await keepAudioForGap1(ctx);
    const { retried, call } = await startRetry(ctx, 'gap-1');

    // The user opens another note: NotesApp passes its editor, useNoteEditor destroys the old one.
    ctx.rerender({ settings: CONFIGURED, editor: createTestEditor(), noteId: 'n2' });
    ctx.editor.destroy();
    await act(async () => {
      call.resolve('補上的文字');
      await retried;
    });

    expect(await createPendingQueue(ctx.db).get('gap-1')).toBeDefined();
    expect(ctx.result.current.error).toBe(RECORDER_MESSAGES.retryFailed);

    // Back in the first note (a fresh editor from its saved content), the marker still works.
    const reopened = createTestEditor(`<p>${GAP_1}</p>`);
    ctx.rerender({ settings: CONFIGURED, editor: reopened, noteId: 'n1' });
    ctx.transcribe.mockResolvedValueOnce({ seq: 1, text: '補上的文字' });
    await act(async () => {
      await ctx.result.current.retryGap('gap-1');
    });

    expect(reopened.getHTML()).toBe('<p>補上的文字</p>');
    expect(ctx.result.current.error).toBeNull();
    expect(await createPendingQueue(ctx.db).get('gap-1')).toBeUndefined();
  });

  it('retryGap keeps the audio, without a message, when the marker was deleted while waiting', async () => {
    const ctx = await setupRecorder({ content: `<p>前${GAP_1}</p>` });
    await keepAudioForGap1(ctx);
    const { retried, call } = await startRetry(ctx, 'gap-1');

    act(() => {
      ctx.editor.commands.deleteRange({ from: 2, to: 3 }); // Backspace over the marker after 前
    });
    await act(async () => {
      call.resolve('補上的文字');
      await retried;
    });

    expect(ctx.editor.getHTML()).toBe('<p>前</p>');
    expect(ctx.result.current.error).toBeNull();
    // Undo can bring the marker back; the audio goes when the note is deleted (removeByNote).
    expect(await createPendingQueue(ctx.db).get('gap-1')).toBeDefined();
  });

  it('a rejected key (401) stops recording, keeps the audio as a gap and asks for settings', async () => {
    const ctx = await setupRecorder();
    ctx.transcribe.mockRejectedValue(new ApiError('unauthorized', 401, { code: 'unauthorized' }));

    await recordSegments(ctx, 1);

    await waitFor(() => expect(ctx.result.current.state).toBe('idle'));
    expect(ctx.transcribe).toHaveBeenCalledTimes(1); // 401 is never retried
    expect(ctx.result.current.error).toBe('存取金鑰錯誤，請重新設定');
    expect(ctx.onUnauthorized).toHaveBeenCalledTimes(1);
    expect(ctx.track.stop).toHaveBeenCalled();
    expect(ctx.editor.getHTML()).toBe(`<p>${GAP_1}</p>`);

    ctx.rerender({ settings: { ...CONFIGURED, accessKey: 'key-2' } });
    expect(ctx.result.current.error).toBeNull();
  });

  it('skips a segment the server refuses as too large (413) or malformed (400)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ctx = await setupRecorder();
    ctx.transcribe.mockImplementation(async (input) => {
      if (input.seq === 1) throw new ApiError('too large', 413);
      if (input.seq === 2) throw new ApiError('bad', 400);
      return { seq: input.seq, text: '第三段' };
    });

    await recordSegments(ctx, 3);

    await waitFor(() => expect(ctx.editor.getText()).toBe('第三段'));
    expect(ctx.editor.getHTML()).not.toContain('oc-gap');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('skips a segment over MAX_AUDIO_BYTES without uploading it, like a 413', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ctx = await setupRecorder();
    ctx.transcribe.mockImplementation(async (input) => ({ seq: input.seq, text: `第${input.seq}段` }));
    const sized = (bytes: number) =>
      new Blob([new Uint8Array(bytes)], { type: 'audio/webm;codecs=opus' });
    await act(async () => {
      await ctx.result.current.start();
    });

    act(() => {
      ctx.recorders[0].options.onSegment({ seq: 1, blob: sized(MAX_AUDIO_BYTES + 1) });
      ctx.recorders[0].options.onSegment({ seq: 2, blob: sized(MAX_AUDIO_BYTES) });
    });

    await waitFor(() => expect(ctx.editor.getText()).toBe('第2段'));
    expect(ctx.transcribe.mock.calls.map(([input]) => input.seq)).toEqual([2]);
    expect(ctx.editor.getHTML()).not.toContain('oc-gap');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await createPendingQueue(ctx.db).get('gap-1')).toBeUndefined();
  });

  it('after an interruption in the background, shows a notice once the page is visible again', async () => {
    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    const ctx = await setupRecorder();
    await act(async () => {
      await ctx.result.current.start();
    });

    visibility = 'hidden';
    act(() => ctx.recorders[0].interrupt());
    await waitFor(() => expect(ctx.result.current.state).toBe('idle'));
    expect(ctx.result.current.notice).toBeNull();

    visibility = 'visible';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(ctx.result.current.notice).toBe('錄音已中斷，已錄的部分會照常轉寫');
  });

  it('dismissMessages clears the error and the notice', async () => {
    const ctx = await setupRecorder();
    await act(async () => {
      await ctx.result.current.start();
    });
    act(() => ctx.recorders[0].interrupt()); // visible: notice right away
    await settle();
    expect(ctx.result.current.notice).toBe(RECORDER_MESSAGES.interrupted);

    act(() => ctx.result.current.dismissMessages());

    expect(ctx.result.current.notice).toBeNull();
    expect(ctx.result.current.error).toBeNull();
  });
});
