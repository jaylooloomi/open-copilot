import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settle, setupRecorder } from '../test/recorderHarness';
import { RECORDER_MESSAGES } from './useRecorder';

type Ctx = Awaited<ReturnType<typeof setupRecorder>>;

afterEach(() => {
  vi.restoreAllMocks();
});

async function startAt(ctx: Ctx, now: number) {
  ctx.clock.now = now;
  await act(async () => {
    await ctx.result.current.start();
  });
}

async function stop(ctx: Ctx) {
  await act(async () => {
    await ctx.result.current.stop();
  });
}

/** One reading from the latest recorder at the given clock time. */
function reading(ctx: Ctx, now: number, rms: number) {
  act(() => {
    ctx.clock.now = now;
    ctx.recorders.at(-1)!.level(rms);
  });
}

describe('useRecorder: live recording feedback', () => {
  it('has the no-sound message', () => {
    expect(RECORDER_MESSAGES.noSound).toBe('沒有偵測到聲音，請確認麥克風');
  });

  it('shows nothing before recording', async () => {
    const { result } = await setupRecorder();
    expect(result.current.startedAt).toBeNull();
    expect(result.current.levels.get()).toBe(0);
    expect(result.current.noSound).toBe(false);
  });

  it('reports when the recording started and clears it once stopping begins', async () => {
    const ctx = await setupRecorder();
    await startAt(ctx, 42_000);
    expect(ctx.result.current.state).toBe('recording');
    expect(ctx.result.current.startedAt).toBe(42_000);

    await stop(ctx);
    expect(ctx.result.current.startedAt).toBeNull();
  });

  it('counts from when the microphone is granted, not from the click, after a delayed permission prompt', async () => {
    const ctx = await setupRecorder();
    // The permission prompt stays open for 5 s: the clock moves while getUserMedia is pending.
    ctx.deps.getUserMedia.mockImplementationOnce(async () => {
      ctx.clock.now = 5_000;
      return ctx.stream;
    });
    await startAt(ctx, 0);
    expect(ctx.result.current.state).toBe('recording');
    // The timer appears at 00:00 instead of 00:05.
    expect(ctx.result.current.startedAt).toBe(5_000);
  });

  it('passes every reading to the level store', async () => {
    const ctx = await setupRecorder();
    await startAt(ctx, 0);
    const listener = vi.fn();
    ctx.result.current.levels.subscribe(listener);

    reading(ctx, 100, 0.3);
    expect(ctx.result.current.levels.get()).toBe(0.3);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('shows the hint after more than 10 s without a reading above the threshold, once per recording', async () => {
    const ctx = await setupRecorder();
    await startAt(ctx, 0);

    reading(ctx, 5_000, 0.001);
    expect(ctx.result.current.noSound).toBe(false);
    reading(ctx, 10_000, 0);
    expect(ctx.result.current.noSound).toBe(false);
    reading(ctx, 10_100, 0);
    expect(ctx.result.current.noSound).toBe(true);

    reading(ctx, 10_200, 0.05);
    expect(ctx.result.current.noSound).toBe(false);
    reading(ctx, 30_000, 0);
    expect(ctx.result.current.noSound).toBe(false);
  });

  it('clears the level and the hint when stopping and ignores later readings', async () => {
    const ctx = await setupRecorder();
    await startAt(ctx, 0);
    reading(ctx, 10_100, 0);
    expect(ctx.result.current.noSound).toBe(true);

    await stop(ctx);
    expect(ctx.result.current.noSound).toBe(false);
    expect(ctx.result.current.levels.get()).toBe(0);

    reading(ctx, 10_200, 0.4);
    expect(ctx.result.current.levels.get()).toBe(0);
    expect(ctx.result.current.noSound).toBe(false);
  });

  it('can show the hint again in the next recording', async () => {
    const ctx = await setupRecorder();
    await startAt(ctx, 0);
    reading(ctx, 10_100, 0);
    expect(ctx.result.current.noSound).toBe(true);
    await stop(ctx);

    await startAt(ctx, 50_000);
    expect(ctx.result.current.startedAt).toBe(50_000);
    reading(ctx, 59_000, 0);
    expect(ctx.result.current.noSound).toBe(false);
    reading(ctx, 60_001, 0);
    expect(ctx.result.current.noSound).toBe(true);
  });

  it('clears the feedback when the component unmounts mid-recording', async () => {
    const ctx = await setupRecorder();
    await startAt(ctx, 0);
    reading(ctx, 100, 0.3);
    ctx.unmount();
    expect(ctx.result.current.levels.get()).toBe(0);
  });
});

describe('useRecorder: 轉寫中 N 段', () => {
  it('counts uploaded segments until their transcript is inserted, in recording order', async () => {
    const ctx = await setupRecorder();
    await startAt(ctx, 0);
    expect(ctx.result.current.transcribing).toBe(0);

    act(() => {
      ctx.recorders[0].emit(1);
      ctx.recorders[0].emit(2);
    });
    expect(ctx.result.current.transcribing).toBe(2);

    ctx.calls[1].resolve('第二段。');
    await settle();
    expect(ctx.result.current.transcribing).toBe(2); // segment 2 waits for segment 1

    ctx.calls[0].resolve('第一段。');
    await settle();
    expect(ctx.result.current.transcribing).toBe(0);
    expect(ctx.editor.getText()).toBe('第一段。第二段。');
  });

  it('counts an empty transcript as done', async () => {
    const ctx = await setupRecorder();
    await startAt(ctx, 0);
    act(() => ctx.recorders[0].emit(1));
    expect(ctx.result.current.transcribing).toBe(1);

    ctx.calls[0].resolve('  ');
    await settle();
    expect(ctx.result.current.transcribing).toBe(0);
  });

  it('counts the last segment while stopping and is back to 0 once stopped', async () => {
    const ctx = await setupRecorder();
    await startAt(ctx, 0);
    ctx.recorders[0].onStop = () => ctx.recorders[0].emit(1);

    let stopped!: Promise<void>;
    act(() => {
      stopped = ctx.result.current.stop();
    });
    await settle();
    expect(ctx.result.current.state).toBe('stopping');
    expect(ctx.result.current.startedAt).toBeNull();
    expect(ctx.result.current.transcribing).toBe(1);

    ctx.calls[0].resolve('最後一段。');
    await act(async () => {
      await stopped;
    });
    expect(ctx.result.current.state).toBe('idle');
    expect(ctx.result.current.transcribing).toBe(0);
  });
});
