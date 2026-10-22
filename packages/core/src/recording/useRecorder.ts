import type { Editor } from '@tiptap/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createApiClient, type ApiClient } from '../api/apiClient';
import { isConfigured, type Settings } from '../settings/settingsStore';
import { OrderedBuffer } from './orderedBuffer';
import type { AppDbHandle } from './pendingQueue';
import { extensionFor, pickMimeType } from './pickMimeType';
import { withRetry } from './retry';
import { SegmentRecorder, type RecordedSegment, type SegmentRecorderOptions } from './segmentRecorder';
import { TranscriptInserter } from './transcriptInserter';

export type RecorderState = 'idle' | 'needsSetup' | 'recording' | 'stopping';

export const RECORDER_MESSAGES = {
  micDenied: '無法使用麥克風，請在系統或瀏覽器設定中允許麥克風權限',
  startFailed: '無法開始錄音，請再試一次',
} as const;

/** How much of the text already inserted in this recording is sent as the prompt. */
export const PROMPT_CHARS = 200;

export interface SegmentRecorderHandle {
  start(): void;
  stop(): Promise<void>;
}

/** Everything useRecorder touches outside React; tests replace these. */
export interface RecorderDeps {
  getUserMedia(): Promise<MediaStream>;
  createRecorder(options: SegmentRecorderOptions): SegmentRecorderHandle;
  createClient(settings: Settings): ApiClient;
  pickMimeType(): string | undefined;
  /** Wait between retries. */
  sleep(ms: number): Promise<void>;
  newGapId(): string;
}

export const defaultRecorderDeps: RecorderDeps = {
  getUserMedia: () => {
    const media = globalThis.navigator?.mediaDevices;
    if (!media?.getUserMedia) return Promise.reject(new Error('getUserMedia is not available'));
    return media.getUserMedia({ audio: true });
  },
  createRecorder: (options) => new SegmentRecorder(options),
  createClient: (settings) =>
    createApiClient({ baseUrl: settings.apiBaseUrl, accessKey: settings.accessKey }),
  pickMimeType: () => pickMimeType(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  newGapId: () => crypto.randomUUID(),
};

export interface UseRecorderOptions {
  /** The editor transcripts go into (NotesApp's useNoteEditor editor). */
  editor: Editor;
  /** Active note; recording cannot start while it is undefined (notes still loading). */
  noteId: string | undefined;
  settings: Settings;
  /** App database (or openAppDb()'s promise) holding untranscribed audio. */
  db: AppDbHandle;
  /** The access key was rejected (401); NotesApp opens the settings dialog. */
  onUnauthorized?(): void;
  deps?: Partial<RecorderDeps>;
}

export interface UseRecorderResult {
  state: RecorderState;
  error: string | null;
  notice: string | null;
  start(): Promise<void>;
  stop(): Promise<void>;
}

type Phase = 'idle' | 'recording' | 'stopping';

type SegmentResult = { kind: 'text'; text: string } | { kind: 'skip' };

interface Session {
  noteId: string;
  client: ApiClient;
  stream: MediaStream;
  recorder: SegmentRecorderHandle;
  inserter: TranscriptInserter;
  buffer: OrderedBuffer<SegmentResult>;
  mimeType: string | undefined;
  /** Text inserted by this recording so far; its tail is the next prompt. */
  transcript: string;
  uploads: Set<Promise<void>>;
  finishing: Promise<void> | null;
}

interface ControllerEnv {
  options(): UseRecorderOptions;
  setPhase(phase: Phase): void;
  setError(message: string | null): void;
  setNotice(message: string | null): void;
}

/**
 * Records with the microphone, uploads every segment as soon as it is cut (in parallel, with
 * retries) and inserts the transcripts strictly in recording order at the cursor position the
 * recording started from.
 */
export function useRecorder(options: UseRecorderOptions): UseRecorderResult {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const latest = useRef({ options });
  useLayoutEffect(() => {
    latest.current = { options };
  });

  const controllerRef = useRef<ReturnType<typeof createRecorderController> | null>(null);
  controllerRef.current ??= createRecorderController({
    options: () => latest.current.options,
    setPhase,
    setError,
    setNotice,
  });
  const controller = controllerRef.current;

  useEffect(() => {
    // Set here as well as in dispose() so that StrictMode's unmount and remount works.
    controller.mount();
    return () => controller.dispose();
  }, [controller]);

  const state: RecorderState =
    phase !== 'idle' ? phase : isConfigured(options.settings) ? 'idle' : 'needsSetup';

  return { state, error, notice, start: controller.start, stop: controller.stop };
}

function createRecorderController(env: ControllerEnv) {
  let session: Session | null = null;
  let starting = false;
  /** False after unmount, so a start() still waiting on the microphone does not record. */
  let mounted = true;

  const deps = (): RecorderDeps => ({ ...defaultRecorderDeps, ...env.options().deps });

  async function start(): Promise<void> {
    const { editor, noteId, settings } = env.options();
    if (session || starting || !noteId || !isConfigured(settings)) return;
    starting = true;
    try {
      const d = deps();
      env.setError(null);
      env.setNotice(null);
      let stream: MediaStream;
      try {
        stream = await d.getUserMedia();
      } catch {
        env.setError(RECORDER_MESSAGES.micDenied);
        return;
      }
      // The permission prompt does not block the page, so the user may have opened another note
      // (useNoteEditor then destroys this editor) or changed the settings meanwhile. Only record
      // into the note that is still on screen.
      const now = env.options();
      if (
        !mounted ||
        now.noteId !== noteId ||
        now.editor !== editor ||
        editor.isDestroyed ||
        !isConfigured(now.settings)
      ) {
        stopTracks(stream);
        return;
      }
      const mimeType = d.pickMimeType();
      // Assigned right below, before the recorder can call back.
      let current: Session;
      const recorder = d.createRecorder({
        stream,
        mimeType,
        onSegment: (segment) => handleSegment(current, segment),
        onInterrupted: () => void finish(current),
      });
      current = {
        noteId,
        client: d.createClient(now.settings),
        stream,
        recorder,
        inserter: new TranscriptInserter(editor, editor.state.selection.to),
        buffer: new OrderedBuffer<SegmentResult>(),
        mimeType,
        transcript: '',
        uploads: new Set(),
        finishing: null,
      };
      try {
        recorder.start();
      } catch (error) {
        console.error('Failed to start recording', error);
        stopTracks(stream);
        current.inserter.destroy();
        env.setError(RECORDER_MESSAGES.startFailed);
        return;
      }
      session = current;
      env.setPhase('recording');
    } finally {
      starting = false;
    }
  }

  async function stop(): Promise<void> {
    if (session) await finish(session);
  }

  function finish(current: Session): Promise<void> {
    current.finishing ??= (async () => {
      env.setPhase('stopping');
      // Delivers the last segment through onSegment before it resolves.
      await current.recorder
        .stop()
        .catch((error: unknown) => console.error('Failed to stop recording', error));
      stopTracks(current.stream);
      while (current.uploads.size > 0) await Promise.allSettled([...current.uploads]);
      current.inserter.destroy();
      if (session === current) session = null;
      env.setPhase('idle');
    })();
    return current.finishing;
  }

  function handleSegment(current: Session, { seq, blob }: RecordedSegment): void {
    const prompt = tail(current.transcript, PROMPT_CHARS);
    const mimeType = blob.type || current.mimeType || '';
    const upload: Promise<void> = transcribeSegment(current, seq, blob, mimeType, prompt)
      .then((result) => release(current, seq, result))
      .catch((error: unknown) => console.error(`Failed to handle segment ${seq}`, error))
      .finally(() => {
        current.uploads.delete(upload);
      });
    current.uploads.add(upload);
  }

  async function transcribeSegment(
    current: Session,
    seq: number,
    blob: Blob,
    mimeType: string,
    prompt: string,
  ): Promise<SegmentResult> {
    const d = deps();
    try {
      const response = await withRetry(
        () =>
          current.client.transcribe({
            audio: blob,
            seq,
            prompt,
            filename: `segment-${seq}.${extensionFor(mimeType)}`,
          }),
        { sleep: d.sleep },
      );
      return response.text.trim() === '' ? { kind: 'skip' } : { kind: 'text', text: response.text };
    } catch (error) {
      // Dropped so that later segments are not held up.
      console.error(`Segment ${seq} could not be transcribed`, error);
      return { kind: 'skip' };
    }
  }

  /** Inserts every result that is now next in line. */
  function release(current: Session, seq: number, result: SegmentResult): void {
    for (const item of current.buffer.put(seq, result)) {
      if (item.kind !== 'text') continue;
      // One failing insert must not drop the rest of the batch, which has already left the buffer.
      try {
        current.inserter.insertText(item.text);
        current.transcript += item.text;
      } catch (error) {
        console.error('Failed to insert a transcript', error);
      }
    }
  }

  /** Unmount: stop the microphone; uploads still finish but insert nothing. */
  function mount(): void {
    mounted = true;
  }

  function dispose(): void {
    mounted = false;
    const current = session;
    if (!current) return;
    session = null;
    current.inserter.destroy();
    void current.recorder.stop().catch(() => undefined);
    stopTracks(current.stream);
  }

  return { start, stop, mount, dispose };
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** The last `count` characters (code points) of text. */
function tail(text: string, count: number): string {
  const chars = Array.from(text);
  return chars.length <= count ? text : chars.slice(-count).join('');
}
