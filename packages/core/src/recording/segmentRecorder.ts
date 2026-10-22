import { computeRms } from './rms';
import { SegmentPolicy } from './segmentPolicy';

export interface RecordedSegment {
  /** 1, 2, 3… in recording order, without gaps. */
  seq: number;
  blob: Blob;
}

export interface SegmentRecorderOptions {
  stream: MediaStream;
  /** From pickMimeType(); undefined lets MediaRecorder choose. */
  mimeType?: string;
  onSegment(segment: RecordedSegment): void;
  /** A track of the stream ended (device unplugged, app sent to the background…). */
  onInterrupted(): void;
  policy?: SegmentPolicy;
  now?: () => number;
  createAudioContext?: () => AudioContext;
  /** How often the volume is checked (default 50ms). */
  pollMs?: number;
}

interface Segment {
  recorder: MediaRecorder;
  /** Settles once the recorder's `stop` event has been handled. */
  done: Promise<void>;
}

/**
 * Records a stream as a series of independently decodable files: every segment gets its own
 * MediaRecorder (no timeslice, whose later chunks lack the container header). A SegmentPolicy
 * fed with the analyser's RMS decides where to cut.
 */
export class SegmentRecorder {
  private readonly policy: SegmentPolicy;
  private readonly now: () => number;
  private current: Segment | null = null;
  private nextSeq = 1;
  private timer: ReturnType<typeof setInterval> | undefined;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples = new Float32Array(0);
  private started = false;
  private stopping: Promise<void> | null = null;

  constructor(private readonly options: SegmentRecorderOptions) {
    this.policy = options.policy ?? new SegmentPolicy();
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.setUpAnalyser();
    for (const track of this.options.stream.getTracks()) {
      track.addEventListener('ended', this.onTrackEnded);
    }
    this.current = this.beginSegment();
    this.policy.start(this.now());
    this.timer = setInterval(() => this.poll(), this.options.pollMs ?? 50);
  }

  /** Ends recording; resolves after the last segment has been passed to onSegment. */
  stop(): Promise<void> {
    if (!this.started) return Promise.resolve();
    this.stopping ??= this.finish();
    return this.stopping;
  }

  private readonly onTrackEnded = () => {
    if (this.stopping) return;
    this.options.onInterrupted();
    void this.stop();
  };

  private async finish(): Promise<void> {
    clearInterval(this.timer);
    for (const track of this.options.stream.getTracks()) {
      track.removeEventListener('ended', this.onTrackEnded);
    }
    const last = this.current;
    this.current = null;
    if (last) {
      if (last.recorder.state !== 'inactive') last.recorder.stop();
      await last.done;
    }
    await this.audioContext?.close().catch(() => undefined);
  }

  private poll(): void {
    if (!this.current || this.stopping) return;
    if (this.policy.update(this.now(), this.readRms()) === 'cut') this.cut();
  }

  private cut(): void {
    const previous = this.current;
    if (!previous) return;
    if (previous.recorder.state !== 'inactive') previous.recorder.stop();
    this.current = this.beginSegment();
    this.policy.start(this.now());
  }

  private beginSegment(): Segment {
    const { stream, mimeType } = this.options;
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    const done = new Promise<void>((resolve) => {
      recorder.addEventListener(
        'stop',
        () => {
          try {
            if (chunks.length > 0) {
              const type = recorder.mimeType || mimeType || '';
              // Numbered when delivered, so an empty segment never leaves a hole in the sequence.
              this.options.onSegment({ seq: this.nextSeq++, blob: new Blob(chunks, { type }) });
            }
          } finally {
            resolve();
          }
        },
        { once: true },
      );
    });
    recorder.start();
    return { recorder, done };
  }

  private setUpAnalyser(): void {
    try {
      const context = (this.options.createAudioContext ?? (() => new AudioContext()))();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(this.options.stream).connect(analyser);
      // Some browsers create a suspended context; the 錄製 click lets it resume.
      if (context.state === 'suspended') void context.resume().catch(() => undefined);
      this.audioContext = context;
      this.analyser = analyser;
      this.samples = new Float32Array(analyser.fftSize);
    } catch {
      // Without an analyser every reading counts as speech, so segments are cut at maxMs.
      this.audioContext = null;
      this.analyser = null;
    }
  }

  private readRms(): number {
    if (!this.analyser) return 1;
    this.analyser.getFloatTimeDomainData(this.samples);
    return computeRms(this.samples);
  }
}
