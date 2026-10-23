import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUpdateReloadGate, trackPageActivity } from './updateReloadGate';

afterEach(() => {
  vi.useRealTimers();
});

class FakeTrack extends EventTarget {
  readyState: MediaStreamTrackState = 'live';
  stop() {
    this.readyState = 'ended';
  }
}

function fakeMediaDevices(track: FakeTrack) {
  const stream = { getAudioTracks: () => [track as unknown as MediaStreamTrack] } as MediaStream;
  return { getUserMedia: vi.fn(async () => stream) } as unknown as MediaDevices;
}

describe('trackPageActivity', () => {
  it('is busy while a microphone track is live', async () => {
    const track = new FakeTrack();
    const mediaDevices = fakeMediaDevices(track);
    const scope = { fetch: vi.fn(async () => new Response('ok')) } as unknown as typeof globalThis;
    const activity = trackPageActivity({ mediaDevices, scope });
    expect(activity.isBusy()).toBe(false);
    await mediaDevices.getUserMedia({ audio: true });
    expect(activity.isBusy()).toBe(true);
    track.stop();
    expect(activity.isBusy()).toBe(false);
    activity.uninstall();
  });

  it('is busy while a request (a segment upload) is in flight', async () => {
    let finish!: (r: Response) => void;
    const scope = {
      fetch: vi.fn(() => new Promise<Response>((resolve) => (finish = resolve))),
    } as unknown as typeof globalThis;
    const activity = trackPageActivity({ mediaDevices: undefined, scope });
    const pending = scope.fetch('/api/transcribe');
    expect(activity.isBusy()).toBe(true);
    finish(new Response('ok'));
    await pending;
    expect(activity.isBusy()).toBe(false);
    activity.uninstall();
  });

  it('stops counting a request that failed', async () => {
    const scope = { fetch: vi.fn(async () => Promise.reject(new TypeError('offline'))) } as unknown as typeof globalThis;
    const activity = trackPageActivity({ mediaDevices: undefined, scope });
    await expect(scope.fetch('/api/transcribe')).rejects.toThrow('offline');
    expect(activity.isBusy()).toBe(false);
    activity.uninstall();
  });
});

describe('createUpdateReloadGate', () => {
  it('reloads at once when nothing is recording or uploading', () => {
    const reload = vi.fn();
    createUpdateReloadGate({ isBusy: () => false, reload })();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits until the recording and its uploads are done before reloading', () => {
    vi.useFakeTimers();
    let busy = true;
    const reload = vi.fn();
    createUpdateReloadGate({ isBusy: () => busy, reload, intervalMs: 1000 })();
    vi.advanceTimersByTime(5000);
    expect(reload).not.toHaveBeenCalled();
    busy = false;
    vi.advanceTimersByTime(1000);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps one wait when the update is reported twice', () => {
    vi.useFakeTimers();
    let busy = true;
    const reload = vi.fn();
    const onNeedReload = createUpdateReloadGate({ isBusy: () => busy, reload, intervalMs: 1000 });
    onNeedReload();
    onNeedReload();
    busy = false;
    vi.advanceTimersByTime(1000);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
