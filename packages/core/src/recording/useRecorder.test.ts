import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CONFIGURED, createTestEditor, settle, setupRecorder } from '../test/recorderHarness';
import { RECORDER_MESSAGES } from './useRecorder';

describe('useRecorder: recording', () => {
  it('needs setup until both a backend URL and an access key are saved', async () => {
    const { result, rerender, deps } = await setupRecorder({ settings: { apiBaseUrl: 'https://api.test', accessKey: '' } });
    expect(result.current.state).toBe('needsSetup');

    await act(async () => {
      await result.current.start();
    });
    expect(deps.getUserMedia).not.toHaveBeenCalled();

    rerender({ settings: CONFIGURED });
    expect(result.current.state).toBe('idle');
  });

  it('records from the cursor and inserts transcripts in recording order', async () => {
    const { result, editor, recorders, calls, deps } = await setupRecorder({ content: '<p>開頭結尾</p>' });
    act(() => {
      editor.commands.setTextSelection(3); // between 開頭 and 結尾
    });

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe('recording');
    expect(deps.createClient).toHaveBeenCalledWith(CONFIGURED);
    expect(recorders[0].started).toBe(true);
    expect(recorders[0].options.mimeType).toBe('audio/webm;codecs=opus');

    act(() => {
      recorders[0].emit(1);
      recorders[0].emit(2);
    });
    expect(calls.map((c) => [c.input.seq, c.input.filename])).toEqual([
      [1, 'segment-1.webm'],
      [2, 'segment-2.webm'],
    ]);

    calls[1].resolve('第二段。');
    await settle();
    expect(editor.getText()).toBe('開頭結尾'); // segment 2 waits for segment 1

    calls[0].resolve('第一段。');
    await settle();
    expect(editor.getText()).toBe('開頭第一段。第二段。結尾');
  });

  it('keeps inserting at its own spot while the user types elsewhere', async () => {
    const { result, editor, recorders, calls } = await setupRecorder({ content: '<p>AB</p>' });
    act(() => {
      editor.commands.setTextSelection(2);
    });
    await act(async () => {
      await result.current.start();
    });
    act(() => recorders[0].emit(1));
    act(() => {
      editor.commands.insertContentAt(1, '使用者');
    });

    calls[0].resolve('轉寫');
    await settle();

    expect(editor.getText()).toBe('使用者A轉寫B');
  });

  it('sends the last 200 characters it inserted as the prompt', async () => {
    const { result, recorders, calls } = await setupRecorder();
    await act(async () => {
      await result.current.start();
    });
    act(() => recorders[0].emit(1));
    expect(calls[0].input.prompt).toBe('');

    calls[0].resolve(`${'甲'.repeat(150)}${'乙'.repeat(100)}`);
    await settle();
    act(() => recorders[0].emit(2));

    expect(calls[1].input.prompt).toBe(`${'甲'.repeat(100)}${'乙'.repeat(100)}`);
  });

  it('skips empty transcripts without holding up later segments', async () => {
    const { result, editor, recorders, calls } = await setupRecorder();
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      recorders[0].emit(1);
      recorders[0].emit(2);
    });

    calls[0].resolve('  ');
    calls[1].resolve('有內容');
    await settle();

    expect(editor.getText()).toBe('有內容');
  });

  it('stop() delivers the last segment, waits for every upload, then releases the microphone', async () => {
    const { result, editor, recorders, calls, track } = await setupRecorder();
    await act(async () => {
      await result.current.start();
    });
    act(() => recorders[0].emit(1));
    recorders[0].onStop = () => recorders[0].emit(2);

    let stopped!: Promise<void>;
    act(() => {
      stopped = result.current.stop();
    });
    expect(result.current.state).toBe('stopping');
    await settle();
    expect(recorders[0].stop).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalled();
    expect(calls).toHaveLength(2);

    await act(async () => {
      calls[0].resolve('一');
      calls[1].resolve('二');
      await stopped;
    });

    expect(result.current.state).toBe('idle');
    expect(editor.getText()).toBe('一二');
  });

  it('reports a denied microphone and stays idle', async () => {
    const { result, deps, recorders } = await setupRecorder();
    deps.getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBe('無法使用麥克風，請在系統或瀏覽器設定中允許麥克風權限');
    expect(RECORDER_MESSAGES.micDenied).toBe(result.current.error);
    expect(recorders).toHaveLength(0);
  });

  it('gives the microphone back when another note is opened while the permission prompt is up', async () => {
    const { result, rerender, deps, recorders, stream, track } = await setupRecorder();
    let grant!: () => void;
    deps.getUserMedia.mockImplementationOnce(
      () =>
        new Promise<MediaStream>((resolve) => {
          grant = () => resolve(stream);
        }),
    );

    let started!: Promise<void>;
    act(() => {
      started = result.current.start();
    });
    // The prompt does not block the page: the note list is still usable and NotesApp hands the
    // hook the new note's editor (useNoteEditor destroys the old one).
    rerender({ settings: CONFIGURED, editor: createTestEditor(), noteId: 'n2' });
    await act(async () => {
      grant();
      await started;
    });

    expect(result.current.state).toBe('idle');
    expect(track.stop).toHaveBeenCalled();
    expect(recorders).toHaveLength(0);
    expect(deps.createClient).not.toHaveBeenCalled();
  });

  it('releases the microphone when the component unmounts mid-recording', async () => {
    const { result, recorders, track, unmount } = await setupRecorder();
    await act(async () => {
      await result.current.start();
    });

    unmount();

    expect(recorders[0].stop).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
  });
});
