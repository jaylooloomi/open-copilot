/** The document, or a stand-in in tests. */
export interface VisibilityTarget extends EventTarget {
  readonly visibilityState: DocumentVisibilityState;
}

export interface BackgroundMicGuardOptions {
  /** Defaults to `document`. */
  target?: VisibilityTarget;
  /** Defaults to `navigator.mediaDevices`. */
  mediaDevices?: MediaDevices;
}

/**
 * Android keeps a backgrounded app's microphone track "live" but feeds it silence, so M3b's
 * SegmentRecorder would keep uploading silent segments and never report an interruption. In the
 * Capacitor app, end every live microphone track as soon as the app is paused or hidden: the
 * `ended` event makes SegmentRecorder hand over what was recorded, and useRecorder shows
 * 「錄音已中斷，已錄的部分會照常轉寫」 once the app is in front again.
 *
 * Returns a function that removes the guard.
 */
export function installBackgroundMicGuard(options: BackgroundMicGuardOptions = {}): () => void {
  const target: VisibilityTarget = options.target ?? document;
  const mediaDevices = options.mediaDevices ?? globalThis.navigator?.mediaDevices;
  if (!mediaDevices?.getUserMedia) return () => undefined;

  const original = mediaDevices.getUserMedia;
  const tracks = new Set<MediaStreamTrack>();

  mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    const stream = await original.call(mediaDevices, constraints);
    for (const track of stream.getAudioTracks()) tracks.add(track);
    return stream;
  };

  const endTracks = () => {
    for (const track of tracks) {
      if (track.readyState !== 'live') continue;
      // stop() never fires `ended`. Fire it first, while the track still delivers audio, so the
      // recorder stops its MediaRecorder with everything recorded so far; then free the mic.
      track.dispatchEvent(new Event('ended'));
      track.stop();
    }
    tracks.clear();
  };

  const onVisibilityChange = () => {
    if (target.visibilityState === 'hidden') endTracks();
  };

  target.addEventListener('visibilitychange', onVisibilityChange);
  // Capacitor fires `pause` on document when the Android activity is paused.
  target.addEventListener('pause', endTracks);

  return () => {
    target.removeEventListener('visibilitychange', onVisibilityChange);
    target.removeEventListener('pause', endTracks);
    mediaDevices.getUserMedia = original;
    tracks.clear();
  };
}
