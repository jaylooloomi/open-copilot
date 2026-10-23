import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAudioContext, createFakeStream, FakeMediaRecorder } from '../test/media';
import { SegmentPolicy } from './segmentPolicy';
import { SegmentRecorder } from './segmentRecorder';

const SPEECH = 0.2;

/**
 * Most tests below were written for 4–8 s segments. They test the recorder (cuts, stop, interruptions),
 * not the policy's defaults (segmentPolicy.test.ts covers those), so they pin these limits.
 * Pass policy: 'default' to get the recorder's own default policy.
 */
const SHORT_SEGMENTS = { minMs: 4000, maxMs: 8000 } as const;

function setup(
  options: {
    mimeType?: string;
    audioContext?: 'fake' | 'throws';
    onLevel?: (rms: number) => void;
    levelMs?: number;
    policy?: SegmentPolicy | 'default';
    now?: () => number;
  } = {},
) {
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
    onLevel: options.onLevel,
    levelMs: options.levelMs,
    policy:
      options.policy === 'default' ? undefined : (options.policy ?? new SegmentPolicy(SHORT_SEGMENTS)),
    now: options.now,
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

  it('uses the 8–12 s default policy when none is given', async () => {
    const { recorder, segments } = setup({ policy: 'default' });
    recorder.start();
    await vi.advanceTimersByTimeAsync(11_950);
    expect(recorders()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(recorders()).toHaveLength(2);
    expect(segments.map((s) => s.seq)).toEqual([1]);
    await recorder.stop();
  });

  it('does not cut at a pause before 8 s with the default policy', async () => {
    const { recorder, segments, audio } = setup({ policy: 'default' });
    recorder.start();
    await vi.advanceTimersByTimeAsync(5000);
    audio.setLevel(0);
    // The pause has lasted far longer than 300ms by 7950ms, but 8 s have not passed yet.
    await vi.advanceTimersByTimeAsync(2950);
    expect(recorders()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(recorders()).toHaveLength(2);
    expect(segments.map((s) => s.seq)).toEqual([1]);
    await recorder.stop();
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

  it('stop() can be called twice and returns the same promise', async () => {
    const { recorder, segments } = setup();
    recorder.start();
    const first = recorder.stop();
    expect(recorder.stop()).toBe(first);
    await first;
    expect(segments.map((s) => s.seq)).toEqual([1]);
  });

  it('stop() right after a cut waits for the segment the cut stopped', async () => {
    const { recorder, segments, audio } = setup();
    recorder.start();
    recorders()[0].stopDelayMs = 100;
    await vi.advanceTimersByTimeAsync(8000);
    expect(recorders()).toHaveLength(2);

    let resolved = false;
    const stopped = recorder.stop().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);
    expect(audio.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    await stopped;
    expect(segments).toHaveLength(2);
    expect(audio.close).toHaveBeenCalledTimes(1);
  });

  it('reports an interruption when a new MediaRecorder cannot be started at a cut', async () => {
    const { recorder, segments, onInterrupted, audio } = setup();
    recorder.start();
    vi.stubGlobal(
      'MediaRecorder',
      class extends FakeMediaRecorder {
        constructor(stream: MediaStream) {
          super(stream);
          throw new Error('stream inactive');
        }
      },
    );
    await vi.advanceTimersByTimeAsync(8000);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(onInterrupted).toHaveBeenCalledTimes(1);
    expect(segments.map((s) => s.seq)).toEqual([1]);
    expect(audio.close).toHaveBeenCalledTimes(1);
    await recorder.stop();
  });

  it('counts readings as speech while the audio context is not running', async () => {
    const { recorder, audio } = setup();
    (audio.context as unknown as { state: string }).state = 'suspended';
    audio.setLevel(0);
    recorder.start();
    await vi.advanceTimersByTimeAsync(7950);
    expect(recorders()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(recorders()).toHaveLength(2);
    await recorder.stop();
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
    const { recorder, segments, onInterrupted, end, audio } = setup();
    recorder.start();
    await vi.advanceTimersByTimeAsync(2000);

    end();
    await vi.advanceTimersByTimeAsync(0);
    end();
    await vi.advanceTimersByTimeAsync(0);

    expect(onInterrupted).toHaveBeenCalledTimes(1);
    expect(audio.close).toHaveBeenCalledTimes(1);
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

describe('SegmentRecorder onLevel', () => {
  it('reports the microphone level about every 100ms', async () => {
    const onLevel = vi.fn();
    const { recorder } = setup({ onLevel });
    recorder.start();

    await vi.advanceTimersByTimeAsync(50);
    expect(onLevel).toHaveBeenCalledTimes(1);
    expect(onLevel.mock.calls[0]![0]).toBeCloseTo(SPEECH);

    await vi.advanceTimersByTimeAsync(50); // 100ms: only 50ms since the last report
    expect(onLevel).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(50); // 150ms
    expect(onLevel).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(900); // 1050ms: reports at 50, 150, …, 1050
    expect(onLevel).toHaveBeenCalledTimes(11);
    await recorder.stop();
  });

  it('reports silence as well', async () => {
    const onLevel = vi.fn();
    const { recorder, audio } = setup({ onLevel });
    recorder.start();
    await vi.advanceTimersByTimeAsync(50);
    audio.setLevel(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(onLevel).toHaveBeenLastCalledWith(0);
    await recorder.stop();
  });

  it('tolerates a poll that lands slightly early', async () => {
    const onLevel = vi.fn();
    // Real timers drift: the poll due at 150ms reads the clock at 149ms.
    const now = () => (Date.now() === 150 ? 149 : Date.now());
    const { recorder } = setup({ onLevel, now });
    recorder.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(onLevel).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100); // 150ms (read as 149): 99ms since the last report
    expect(onLevel).toHaveBeenCalledTimes(2);
    await recorder.stop();
  });

  it('takes its own reporting interval', async () => {
    const onLevel = vi.fn();
    const { recorder } = setup({ onLevel, levelMs: 200 });
    recorder.start();
    await vi.advanceTimersByTimeAsync(1050); // reports at 50, 250, 450, 650, 850, 1050
    expect(onLevel).toHaveBeenCalledTimes(6);
    await recorder.stop();
  });

  it('reports nothing while the audio context is not running', async () => {
    const onLevel = vi.fn();
    const { recorder, audio } = setup({ onLevel });
    // The fake resume() never sets the state to 'running', so the context stays suspended
    // throughout. If the fake ever becomes realistic, this test must keep it suspended itself.
    (audio.context as unknown as { state: string }).state = 'suspended';
    recorder.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onLevel).not.toHaveBeenCalled();
    await recorder.stop();
  });

  it('reports nothing without an AudioContext', async () => {
    const onLevel = vi.fn();
    const { recorder } = setup({ onLevel, audioContext: 'throws' });
    recorder.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onLevel).not.toHaveBeenCalled();
    await recorder.stop();
  });

  it('keeps cutting segments when onLevel throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onLevel = vi.fn(() => {
      throw new Error('listener failed');
    });
    const { recorder } = setup({ onLevel, policy: new SegmentPolicy({ minMs: 1000, maxMs: 2000 }) });
    recorder.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(recorders()).toHaveLength(2);
    expect(error).toHaveBeenCalledWith('Failed to report the microphone level', expect.any(Error));
    await recorder.stop();
    error.mockRestore();
  });

  it('stops reporting once stopped', async () => {
    const onLevel = vi.fn();
    const { recorder } = setup({ onLevel });
    recorder.start();
    await vi.advanceTimersByTimeAsync(150);
    await recorder.stop();
    const reported = onLevel.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(onLevel).toHaveBeenCalledTimes(reported);
  });
});
