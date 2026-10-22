import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAudioContext, createFakeStream, FakeMediaRecorder } from '../test/media';
import { SegmentRecorder } from './segmentRecorder';

const SPEECH = 0.2;

function setup(options: { mimeType?: string; audioContext?: 'fake' | 'throws' } = {}) {
  const { stream, track, end } = createFakeStream();
  const audio = createFakeAudioContext();
  audio.setLevel(SPEECH);
  const segments: { seq: number; blob: Blob }[] = [];
  const onInterrupted = vi.fn();
  const recorder = new SegmentRecorder({
    stream,
    mimeType: options.mimeType,
    onSegment: (segment) => segments.push(segment),
    onInterrupted,
    createAudioContext:
      options.audioContext === 'throws'
        ? () => {
            throw new Error('no audio context');
          }
        : () => audio.context,
  });
  return { recorder, segments, onInterrupted, audio, track, end };
}

const recorders = () => FakeMediaRecorder.instances;

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
  FakeMediaRecorder.reset();
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SegmentRecorder', () => {
  it('starts one MediaRecorder with the mime type and no timeslice', () => {
    const { recorder } = setup({ mimeType: 'audio/webm;codecs=opus' });
    recorder.start();
    expect(recorders()).toHaveLength(1);
    expect(recorders()[0].options).toEqual({ mimeType: 'audio/webm;codecs=opus' });
    expect(recorders()[0].startArgs).toEqual([]);
    expect(recorders()[0].state).toBe('recording');
  });

  it('lets MediaRecorder choose the format when no mime type is given', () => {
    const { recorder } = setup();
    recorder.start();
    expect(recorders()[0].options).toBeUndefined();
  });

  it('cuts 300ms into a pause after 4 seconds and opens a new MediaRecorder', async () => {
    const { recorder, segments, audio } = setup();
    recorder.start();

    await vi.advanceTimersByTimeAsync(4000);
    audio.setLevel(0);
    // The first silent reading is at 4050ms, so the pause reaches 300ms at 4350ms.
    await vi.advanceTimersByTimeAsync(300);
    expect(recorders()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(50);
    expect(recorders()).toHaveLength(2);
    expect(recorders()[0].state).toBe('inactive');
    expect(recorders()[1].state).toBe('recording');
    expect(segments.map((s) => s.seq)).toEqual([1]);
    expect(segments[0].blob.type).toBe('audio/webm');
    expect(segments[0].blob.size).toBe('audio'.length);
  });

  it('forces a cut every 8 seconds while someone keeps talking', async () => {
    const { recorder, segments } = setup();
    recorder.start();
    await vi.advanceTimersByTimeAsync(7950);
    expect(recorders()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(recorders()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(8000);
    expect(recorders()).toHaveLength(3);
    expect(segments.map((s) => s.seq)).toEqual([1, 2]);
  });

  it('stop() delivers the last segment, then stops polling and closes the audio context', async () => {
    const { recorder, segments, audio } = setup();
    recorder.start();
    await vi.advanceTimersByTimeAsync(8000);

    await recorder.stop();

    expect(segments.map((s) => s.seq)).toEqual([1, 2]);
    expect(recorders().every((r) => r.state === 'inactive')).toBe(true);
    expect(audio.close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(recorders()).toHaveLength(2);
  });

  it('stop() can be called twice', async () => {
    const { recorder, segments } = setup();
    recorder.start();
    await Promise.all([recorder.stop(), recorder.stop()]);
    expect(segments.map((s) => s.seq)).toEqual([1]);
  });

  it('skips a segment without data and keeps the numbers gapless', async () => {
    const { recorder, segments } = setup();
    recorder.start();
    recorders()[0].data = '';
    await vi.advanceTimersByTimeAsync(8000);
    await recorder.stop();
    expect(segments.map((s) => s.seq)).toEqual([1]);
    expect(segments[0].blob.size).toBe('audio'.length);
  });

  it('reports an ended track as an interruption and delivers what was recorded', async () => {
    const { recorder, segments, onInterrupted, end } = setup();
    recorder.start();
    await vi.advanceTimersByTimeAsync(2000);

    end();
    await vi.advanceTimersByTimeAsync(0);

    expect(onInterrupted).toHaveBeenCalledTimes(1);
    expect(segments.map((s) => s.seq)).toEqual([1]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(recorders()).toHaveLength(1);
  });

  it('falls back to 8-second segments when there is no AudioContext', async () => {
    const { recorder } = setup({ audioContext: 'throws' });
    recorder.start();
    await vi.advanceTimersByTimeAsync(7950);
    expect(recorders()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(recorders()).toHaveLength(2);
    await recorder.stop();
  });
});
