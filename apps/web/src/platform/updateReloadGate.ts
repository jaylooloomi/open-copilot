/**
 * With `autoUpdate` (add-ons design 4) a new deploy's service worker takes over open pages and
 * vite-plugin-pwa would reload them at once. A reload in the middle of a recording would throw away
 * the segment being recorded and every segment still uploading. These helpers let the page put the
 * reload off until it is idle: no live microphone track and no request in flight.
 */

export interface PageActivity {
  /** True while a microphone track is live or a fetch has not settled. */
  isBusy(): boolean;
  /** Restores getUserMedia and fetch. */
  uninstall(): void;
}

export interface TrackPageActivityOptions {
  /** Defaults to `navigator.mediaDevices`. */
  mediaDevices?: MediaDevices;
  /** Whose `fetch` to count. Defaults to `globalThis`. */
  scope?: typeof globalThis;
}

/**
 * Watches the microphone tracks the page opens and the requests it makes. Install it before the
 * app records anything; apiClient looks up the global fetch on every call, so uploads are counted.
 */
export function trackPageActivity(
  options: TrackPageActivityOptions = {},
): PageActivity {
  const mediaDevices = 'mediaDevices' in options ? options.mediaDevices : globalThis.navigator?.mediaDevices;
  const scope = options.scope ?? globalThis;
  const tracks = new Set<MediaStreamTrack>();
  let inFlight = 0;

  const originalGetUserMedia = mediaDevices?.getUserMedia;
  if (mediaDevices && originalGetUserMedia) {
    mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const stream = await originalGetUserMedia.call(mediaDevices, constraints);
      for (const track of stream.getAudioTracks()) tracks.add(track);
      return stream;
    };
  }

  const originalFetch = scope.fetch;
  if (originalFetch) {
    scope.fetch = (async (...args: Parameters<typeof fetch>) => {
      inFlight += 1;
      try {
        return await originalFetch.apply(scope, args);
      } finally {
        inFlight -= 1;
      }
    }) as typeof fetch;
  }

  return {
    isBusy() {
      for (const track of tracks) if (track.readyState !== 'live') tracks.delete(track);
      return tracks.size > 0 || inFlight > 0;
    },
    uninstall() {
      if (mediaDevices && originalGetUserMedia) mediaDevices.getUserMedia = originalGetUserMedia;
      if (originalFetch) scope.fetch = originalFetch;
      tracks.clear();
    },
  };
}

export interface UpdateReloadGateOptions {
  isBusy: () => boolean;
  /** Defaults to `location.reload()`. */
  reload?: () => void;
  /** How often to check again while busy. */
  intervalMs?: number;
}

/**
 * Returns the `onNeedReload` handler for vite-plugin-pwa's registerSW: reload now when the page is
 * idle, otherwise check again every `intervalMs` and reload once it is.
 */
export function createUpdateReloadGate(options: UpdateReloadGateOptions): () => void {
  const reload = options.reload ?? (() => window.location.reload());
  const intervalMs = options.intervalMs ?? 1000;
  let waiting: ReturnType<typeof setInterval> | undefined;

  return () => {
    if (!options.isBusy()) {
      reload();
      return;
    }
    if (waiting !== undefined) return;
    waiting = setInterval(() => {
      if (options.isBusy()) return;
      clearInterval(waiting);
      reload();
    }, intervalMs);
  };
}
