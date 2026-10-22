import { MAX_AUDIO_BYTES } from '@oc/shared';
import type { Editor } from '@tiptap/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApiError, createApiClient, type ApiClient } from '../api/apiClient';
import { isConfigured, type Settings } from '../settings/settingsStore';
import { OrderedBuffer } from './orderedBuffer';
import {
  createPendingQueue,
  type AppDbHandle,
  type PendingQueue,
  type PendingSegment,
} from './pendingQueue';
import { createLevelStore, type LevelSource, type LevelStore } from './levelStore';
import { NoSoundDetector } from './noSoundDetector';
import { extensionFor, pickMimeType } from './pickMimeType';
import { replaceGap } from './replaceGap';
import { withRetry } from './retry';
import { SegmentRecorder, type RecordedSegment, type SegmentRecorderOptions } from './segmentRecorder';
import { TranscriptInserter } from './transcriptInserter';

export type RecorderState = 'idle' | 'needsSetup' | 'recording' | 'stopping';

export const RECORDER_MESSAGES = {
  unauthorized: '存取金鑰錯誤，請重新設定',
  micDenied: '無法使用麥克風，請在系統或瀏覽器設定中允許麥克風權限',
  startFailed: '無法開始錄音，請再試一次',
  interrupted: '錄音已中斷，已錄的部分會照常轉寫',
  retryFailed: '重新轉寫失敗，請稍後再試',
  retryRejected: '伺服器無法轉寫這段錄音',
  audioMissing: '找不到這段錄音，無法重新轉寫',
  noSound: '沒有偵測到聲音，請確認麥克風',
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
  /** Clock (epoch ms) for the recording timer and the no-sound hint. */
  now(): number;
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
  now: () => Date.now(),
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
  /** When the running recording started (deps.now(), epoch ms); null unless state is 'recording'. */
  startedAt: number | null;
  /** The clock startedAt was read from (deps.now); the timer must count with this same clock. */
  now(): number;
  /** The latest microphone level (RMS) while recording, 0 otherwise; read it with useLevel(). */
  levels: LevelSource;
  /** No reading reached the threshold for over 10 s in this recording; a loud reading clears it. */
  noSound: boolean;
  /** Segments uploaded but not inserted yet (waiting for their transcript or an earlier one). */
  transcribing: number;
  start(): Promise<void>;
  stop(): Promise<void>;
  retryGap(gapId: string): Promise<void>;
  /**
   * The note was deleted, so its markers can never be retried: drops the audio kept for them,
   * in memory and in IndexedDB, except the gapIds in `stillReferenced` (markers copied into a note
   * that still exists). Never rejects; failures are logged.
   */
  forgetNote(noteId: string, stillReferenced?: ReadonlySet<string>): Promise<void>;
  /**
   * Drops the kept audio of every gap whose marker no saved note has any more (e.g. retried
   * markers, once the note holding the transcript was saved). NotesApp calls it once the notes are
   * loaded from storage. Audio recorded by this page load is kept: its note may not be saved yet.
   * Never rejects; failures are logged.
   */
  pruneAudio(referenced: ReadonlySet<string>): Promise<void>;
  dismissMessages(): void;
}

type Phase = 'idle' | 'recording' | 'stopping';

type SegmentResult =
  | { kind: 'text'; text: string }
  | { kind: 'gap'; gapId: string; seq: number }
  | { kind: 'skip' };

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
  unauthorized: boolean;
  finishing: Promise<void> | null;
  /** Set on unmount: the inserter is gone, so a late gap would have no marker to retry it from. */
  disposed: boolean;
  /** Decides when this recording shows the no-sound hint. */
  noSound: NoSoundDetector;
  /** Whether the hint is shown now, so the state is only set when it changes. */
  noSoundShown: boolean;
  /** Segments handed to handleSegment that have not left the ordered buffer yet. */
  waiting: number;
}

interface ControllerEnv {
  options(): UseRecorderOptions;
  queue(): PendingQueue;
  levels: LevelStore;
  setPhase(phase: Phase): void;
  setError(message: string | null): void;
  setNotice(message: string | null): void;
  setStartedAt(ms: number | null): void;
  setNoSound(shown: boolean): void;
  setTranscribing(count: number): void;
}

/**
 * Records with the microphone, uploads every segment as soon as it is cut (in parallel, with
 * retries) and inserts the transcripts strictly in recording order at the cursor position the
 * recording started from. A segment that still fails becomes a transcriptGap marker whose audio
 * is kept in IndexedDB until retryGap() succeeds.
 */
export function useRecorder(options: UseRecorderOptions): UseRecorderResult {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [noSound, setNoSound] = useState(false);
  const [transcribing, setTranscribing] = useState(0);
  const [levels] = useState(createLevelStore);
  const queue = useMemo(() => createPendingQueue(options.db), [options.db]);

  const latest = useRef({ options, queue });
  useLayoutEffect(() => {
    latest.current = { options, queue };
  });

  const controllerRef = useRef<ReturnType<typeof createRecorderController> | null>(null);
  controllerRef.current ??= createRecorderController({
    options: () => latest.current.options,
    queue: () => latest.current.queue,
    levels,
    setPhase,
    setError,
    setNotice,
    setStartedAt,
    setNoSound,
    setTranscribing,
  });
  const controller = controllerRef.current;

  useEffect(() => {
    // Set here as well as in dispose() so that StrictMode's unmount and remount works.
    controller.mount();
    document.addEventListener('visibilitychange', controller.onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', controller.onVisibilityChange);
      controller.dispose();
    };
  }, [controller]);

  // New settings (e.g. after a rejected key was replaced) clear the old error.
  const { apiBaseUrl, accessKey } = options.settings;
  useEffect(() => {
    setError(null);
  }, [apiBaseUrl, accessKey]);

  const state: RecorderState =
    phase !== 'idle' ? phase : isConfigured(options.settings) ? 'idle' : 'needsSetup';

  return {
    state,
    error,
    notice,
    startedAt,
    now: controller.now,
    levels,
    noSound,
    transcribing,
    start: controller.start,
    stop: controller.stop,
    retryGap: controller.retryGap,
    forgetNote: controller.forgetNote,
    pruneAudio: controller.pruneAudio,
    dismissMessages: controller.dismissMessages,
  };
}

function createRecorderController(env: ControllerEnv) {
  let session: Session | null = null;
  let starting = false;
  /** False after unmount, so a start() still waiting on the microphone does not record. */
  let mounted = true;
  let interruptedWhileHidden = false;
  /** Audio of gaps from this page load; IndexedDB is the fallback (e.g. after a reload). */
  const pending = new Map<string, PendingSegment>();
  /** Every gap recorded by this page load, retried or not; pruneAudio() leaves their audio alone. */
  const recordedHere = new Set<string>();
  const retrying = new Set<string>();

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
      // The timer counts from here: the microphone is granted and recording begins.
      const startedAt = d.now();
      // Assigned right below, before the recorder can call back.
      let current: Session;
      const recorder = d.createRecorder({
        stream,
        mimeType,
        onSegment: (segment) => handleSegment(current, segment),
        onInterrupted: () => handleInterrupted(current),
        onLevel: (rms) => handleLevel(current, rms),
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
        unauthorized: false,
        finishing: null,
        disposed: false,
        noSound: new NoSoundDetector(startedAt),
        noSoundShown: false,
        waiting: 0,
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
      env.setStartedAt(startedAt);
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
      clearLiveFeedback();
      // Delivers the last segment through onSegment before it resolves.
      await current.recorder
        .stop()
        .catch((error: unknown) => console.error('Failed to stop recording', error));
      stopTracks(current.stream);
      while (current.uploads.size > 0) await Promise.allSettled([...current.uploads]);
      current.inserter.destroy();
      if (session === current) session = null;
      if (!current.disposed) env.setTranscribing(0);
      env.setPhase('idle');
    })();
    return current.finishing;
  }

  function handleLevel(current: Session, rms: number): void {
    // Readings after stop() began, after unmount or from an older recording must not bring the
    // meter or the hint back.
    if (session !== current || current.finishing || current.disposed) return;
    env.levels.set(rms);
    const shown = current.noSound.update(deps().now(), rms);
    if (shown !== current.noSoundShown) {
      current.noSoundShown = shown;
      env.setNoSound(shown);
    }
  }

  /** Timer, level meter and no-sound hint are only shown while recording. */
  function clearLiveFeedback(): void {
    env.setStartedAt(null);
    env.setNoSound(false);
    env.levels.set(0);
  }

  function handleSegment(current: Session, { seq, blob }: RecordedSegment): void {
    // Seqs come from SegmentRecorder as unique integers counting up from 1, so the buffer accepts
    // every one and each counted segment is eventually released. finish() resets the count anyway.
    current.waiting += 1;
    reportWaiting(current);
    const prompt = tail(current.transcript, PROMPT_CHARS);
    const mimeType = blob.type || current.mimeType || '';
    const upload: Promise<void> = transcribeSegment(current, seq, blob, mimeType, prompt)
      .catch((error: unknown) => {
        console.error(`Failed to handle segment ${seq}`, error);
        // This seq must still reach the buffer, or every later transcript would wait behind it.
        return { kind: 'skip' } as const;
      })
      .then((result) => release(current, seq, result))
      .catch((error: unknown) => console.error(`Failed to insert segment ${seq}`, error))
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
    // The server answers 413 for anything bigger (same constant), so do not spend an upload on it.
    // Same outcome as a 413: warn and skip; no gap, since a retry would be refused again.
    if (blob.size > MAX_AUDIO_BYTES) {
      console.warn(`Segment ${seq} is ${blob.size} bytes, over ${MAX_AUDIO_BYTES}, and was skipped`);
      return { kind: 'skip' };
    }
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
      const status = error instanceof ApiError ? error.status : undefined;
      if (status === 400 || status === 413) {
        console.warn(`Segment ${seq} was rejected with ${status} and skipped`, error);
        return { kind: 'skip' };
      }
      if (status === 401) handleUnauthorized(current);
      // After unmount no marker can be inserted, so the audio could never be retried: drop it.
      if (current.disposed) return { kind: 'skip' };
      // Network errors and 5xx after every retry, 401 and anything unexpected: keep the audio.
      const gapId = d.newGapId();
      await keepPending({ gapId, noteId: current.noteId, seq, blob, mimeType, prompt });
      return { kind: 'gap', gapId, seq };
    }
  }

  /** Inserts every result that is now next in line. */
  function release(current: Session, seq: number, result: SegmentResult): void {
    const ready = current.buffer.put(seq, result);
    for (const item of ready) {
      // One failing insert must not drop the rest of the batch, which has already left the buffer.
      try {
        if (item.kind === 'text') {
          current.inserter.insertText(item.text);
          current.transcript += item.text;
        } else if (item.kind === 'gap') {
          // Unmounted while its audio was being stored: no marker, so do not keep the audio.
          if (current.disposed) void dropPending(item.gapId);
          else current.inserter.insertGap(item.gapId, item.seq);
        }
      } catch (error) {
        console.error('Failed to insert a transcript', error);
      }
    }
    if (ready.length > 0) {
      current.waiting -= ready.length;
      reportWaiting(current);
    }
  }

  /** 轉寫中 N 段; an unmounted recording no longer shows anything. */
  function reportWaiting(current: Session): void {
    if (!current.disposed) env.setTranscribing(current.waiting);
  }

  async function keepPending(item: PendingSegment): Promise<void> {
    pending.set(item.gapId, item);
    recordedHere.add(item.gapId);
    try {
      await env.queue().add(item);
    } catch (error) {
      console.error('Failed to keep an untranscribed segment', error);
    }
  }

  async function dropPending(gapId: string): Promise<void> {
    pending.delete(gapId);
    await env
      .queue()
      .remove(gapId)
      .catch((error: unknown) => console.error('Failed to drop an untranscribed segment', error));
  }

  function handleUnauthorized(current: Session): void {
    if (current.unauthorized) return;
    current.unauthorized = true;
    env.setError(RECORDER_MESSAGES.unauthorized);
    env.options().onUnauthorized?.();
    void finish(current);
  }

  function handleInterrupted(current: Session): void {
    if (document.visibilityState === 'hidden') interruptedWhileHidden = true;
    else env.setNotice(RECORDER_MESSAGES.interrupted);
    void finish(current);
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'visible' && interruptedWhileHidden) {
      interruptedWhileHidden = false;
      env.setNotice(RECORDER_MESSAGES.interrupted);
    }
  }

  async function retryGap(gapId: string): Promise<void> {
    // The editor the marker was clicked in. The note list stays usable while a retry runs (up to
    // 1s+2s+4s of backoff plus 30s per attempt), so by the time the answer arrives the props may
    // already hold another note's editor.
    const { settings, editor } = env.options();
    if (retrying.has(gapId) || !isConfigured(settings)) return;
    retrying.add(gapId);
    try {
      const item = pending.get(gapId) ?? (await env.queue().get(gapId).catch(() => undefined));
      if (!item) {
        env.setError(RECORDER_MESSAGES.audioMissing);
        return;
      }
      const d = deps();
      const client = d.createClient(settings);
      const response = await withRetry(
        () =>
          client.transcribe({
            audio: item.blob,
            seq: item.seq,
            prompt: item.prompt,
            filename: `segment-${item.seq}.${extensionFor(item.mimeType)}`,
          }),
        { sleep: d.sleep },
      );
      const text = response.text.trim() === '' ? '' : response.text;
      if (!replaceGap(editor, gapId, text)) {
        // Nothing was replaced, so the audio is still the only copy: keep it. A destroyed editor
        // means the note was switched or deleted; the marker can be clicked again after going
        // back. A live editor without the marker means the user deleted it; undo can bring it
        // back, and the audio goes when the note is deleted (removeByNote).
        if (editor.isDestroyed) env.setError(RECORDER_MESSAGES.retryFailed);
        return;
      }
      // The audio stays (in memory too, for a pasted copy of the marker) instead of leaving the
      // queue now: the note with the transcript is saved later and that save can fail, and then the
      // stored note still has the marker. pruneAudio() drops it once no saved note has the marker.
      env.setError(null);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : undefined;
      if (status === 401) {
        env.setError(RECORDER_MESSAGES.unauthorized);
        env.options().onUnauthorized?.();
      } else if (status === 400 || status === 413) {
        // Retrying again would be refused the same way; say so instead of "try later".
        env.setError(RECORDER_MESSAGES.retryRejected);
      } else {
        env.setError(RECORDER_MESSAGES.retryFailed);
      }
    } finally {
      retrying.delete(gapId);
    }
  }

  async function forgetNote(noteId: string, stillReferenced?: ReadonlySet<string>): Promise<void> {
    for (const [gapId, item] of pending) {
      if (item.noteId === noteId && !stillReferenced?.has(gapId)) pending.delete(gapId);
    }
    try {
      await env.queue().removeByNote(noteId, stillReferenced);
    } catch (error) {
      console.error('Failed to drop the untranscribed audio of a deleted note', error);
    }
  }

  async function pruneAudio(referenced: ReadonlySet<string>): Promise<void> {
    const keep = new Set([...referenced, ...recordedHere]);
    try {
      await env.queue().removeUnreferenced(keep);
    } catch (error) {
      console.error('Failed to drop untranscribed audio no note refers to', error);
    }
  }

  function dismissMessages(): void {
    env.setError(null);
    env.setNotice(null);
  }

  function mount(): void {
    mounted = true;
  }

  /** Unmount: stop the microphone; uploads still finish but insert nothing. */
  function dispose(): void {
    mounted = false;
    const current = session;
    if (!current) return;
    session = null;
    current.disposed = true;
    clearLiveFeedback();
    env.setTranscribing(0);
    current.inserter.destroy();
    void current.recorder.stop().catch(() => undefined);
    stopTracks(current.stream);
  }

  function now(): number {
    return deps().now();
  }

  return {
    start,
    stop,
    now,
    retryGap,
    forgetNote,
    pruneAudio,
    dismissMessages,
    onVisibilityChange,
    mount,
    dispose,
  };
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** The last `count` characters (code points) of text. */
function tail(text: string, count: number): string {
  const chars = Array.from(text);
  return chars.length <= count ? text : chars.slice(-count).join('');
}
