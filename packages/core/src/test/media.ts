import { vi } from 'vitest';

/**
 * jsdom has no MediaRecorder. This fake records how it was used and, like the real one, fires
 * `dataavailable` then `stop` asynchronously after stop(). Install it with
 * `vi.stubGlobal('MediaRecorder', FakeMediaRecorder)` and call `FakeMediaRecorder.reset()` first.
 */
export class FakeMediaRecorder extends EventTarget {
  static instances: FakeMediaRecorder[] = [];
  static supportedTypes = ['audio/webm;codecs=opus', 'audio/mp4'];

  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supportedTypes.includes(type);
  }

  static reset(): void {
    FakeMediaRecorder.instances = [];
  }

  /** What the next stop() delivers; '' simulates a segment without any data. */
  data = 'audio';
  /** Delay before `dataavailable`/`stop` fire after stop(); 0 fires them in a microtask. */
  stopDelayMs = 0;
  state: RecordingState = 'inactive';
  readonly mimeType: string;
  startArgs: unknown[] = [];

  constructor(
    readonly stream: MediaStream,
    readonly options?: MediaRecorderOptions,
  ) {
    super();
    this.mimeType = options?.mimeType ?? 'audio/webm';
    FakeMediaRecorder.instances.push(this);
  }

  start(...args: unknown[]): void {
    this.startArgs = args;
    this.state = 'recording';
  }

  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    const blob = new Blob(this.data ? [this.data] : [], { type: this.mimeType });
    const fire = () => {
      this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: blob }));
      this.dispatchEvent(new Event('stop'));
    };
    if (this.stopDelayMs > 0) setTimeout(fire, this.stopDelayMs);
    else queueMicrotask(fire);
  }
}

/** A one-track MediaStream stand-in; end() fires the track's `ended` event. */
export function createFakeStream() {
  const track = Object.assign(new EventTarget(), {
    kind: 'audio',
    readyState: 'live' as MediaStreamTrackState,
    stop: vi.fn(() => {
      track.readyState = 'ended';
    }),
  });
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track, end: () => track.dispatchEvent(new Event('ended')) };
}

/** An AudioContext stand-in whose analyser reports a constant level set with setLevel(). */
export function createFakeAudioContext() {
  let level = 0;
  const close = vi.fn(async () => undefined);
  const context = {
    state: 'running',
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
    createAnalyser: () => ({
      fftSize: 2048,
      getFloatTimeDomainData: (array: Float32Array) => array.fill(level),
    }),
    resume: vi.fn(async () => undefined),
    close,
  };
  return {
    context: context as unknown as AudioContext,
    close,
    setLevel: (value: number) => {
      level = value;
    },
  };
}
