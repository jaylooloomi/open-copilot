import { afterEach, describe, expect, it, vi } from 'vitest';
import { installBackgroundMicGuard, type VisibilityTarget } from './backgroundMicGuard';

/** A microphone track stand-in; stop() ends it without firing `ended`, like the real one. */
function fakeTrack() {
  const track = Object.assign(new EventTarget(), {
    kind: 'audio',
    readyState: 'live' as MediaStreamTrackState,
    stop: vi.fn(() => {
      track.readyState = 'ended';
    }),
  });
  return track;
}

/** jsdom has no navigator.mediaDevices; this one hands out one fake track per call. */
function fakeMediaDevices() {
  const tracks: ReturnType<typeof fakeTrack>[] = [];
  const getUserMedia = vi.fn(async (_constraints?: MediaStreamConstraints) => {
    const track = fakeTrack();
    tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  });
  const mediaDevices = { getUserMedia } as unknown as MediaDevices;
  return { mediaDevices, getUserMedia, tracks };
}

/** A document stand-in whose visibilityState the test controls. */
function fakeDocument() {
  const target = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
  });
  const setVisibility = (state: DocumentVisibilityState) => {
    target.visibilityState = state;
    target.dispatchEvent(new Event('visibilitychange'));
  };
  return { target: target as VisibilityTarget, setVisibility };
}

let uninstall: () => void = () => undefined;

function setup() {
  const media = fakeMediaDevices();
  const doc = fakeDocument();
  uninstall = installBackgroundMicGuard({ target: doc.target, mediaDevices: media.mediaDevices });
  return { ...media, ...doc };
}

afterEach(() => {
  uninstall();
  uninstall = () => undefined;
});

describe('installBackgroundMicGuard', () => {
  it('hands getUserMedia results through unchanged', async () => {
    const { mediaDevices, getUserMedia } = setup();
    const stream = await mediaDevices.getUserMedia({ audio: true });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stream).toBe(await getUserMedia.mock.results[0].value);
  });

  it('passes getUserMedia failures (e.g. permission denied) through', async () => {
    const { mediaDevices, getUserMedia } = setup();
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    await expect(mediaDevices.getUserMedia({ audio: true })).rejects.toMatchObject({
      name: 'NotAllowedError',
    });
  });

  it('ends live microphone tracks when the app is hidden: `ended` first, then stop()', async () => {
    const { mediaDevices, tracks, setVisibility } = setup();
    await mediaDevices.getUserMedia({ audio: true });
    const [track] = tracks;
    const seen: string[] = [];
    track.addEventListener('ended', () => seen.push(`ended while ${track.readyState}`));

    setVisibility('hidden');

    expect(seen).toEqual(['ended while live']);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(track.readyState).toBe('ended');
  });

  it('ends live microphone tracks when Capacitor pauses the app', async () => {
    const { mediaDevices, tracks, target } = setup();
    await mediaDevices.getUserMedia({ audio: true });

    target.dispatchEvent(new Event('pause'));

    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
  });

  it('leaves tracks alone while the app stays visible', async () => {
    const { mediaDevices, tracks, setVisibility } = setup();
    await mediaDevices.getUserMedia({ audio: true });

    setVisibility('visible');

    expect(tracks[0].stop).not.toHaveBeenCalled();
    expect(tracks[0].readyState).toBe('live');
  });

  it('skips tracks the app has already stopped', async () => {
    const { mediaDevices, tracks, setVisibility } = setup();
    await mediaDevices.getUserMedia({ audio: true });
    const [track] = tracks;
    const ended = vi.fn();
    track.addEventListener('ended', ended);
    track.stop(); // the recording was stopped normally

    setVisibility('hidden');

    expect(ended).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('uninstalling restores getUserMedia and stops listening', async () => {
    const { mediaDevices, getUserMedia, tracks, setVisibility } = setup();
    await mediaDevices.getUserMedia({ audio: true });

    uninstall();
    setVisibility('hidden');

    expect(mediaDevices.getUserMedia).toBe(getUserMedia);
    expect(tracks[0].stop).not.toHaveBeenCalled();
  });

  it('does nothing where there is no getUserMedia (jsdom, old WebViews)', () => {
    const { target } = fakeDocument();
    expect(() => {
      uninstall = installBackgroundMicGuard({ target });
    }).not.toThrow();
  });
});
