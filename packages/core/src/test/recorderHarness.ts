import type { TranscribeResponse } from '@oc/shared';
import { act, renderHook } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import { onTestFinished, vi } from 'vitest';
import type { ApiClient, TranscribeInput } from '../api/apiClient';
import { createExtensions } from '../editor/extensions';
import { openAppDb } from '../platform/db';
import type { SegmentRecorderOptions } from '../recording/segmentRecorder';
import {
  useRecorder,
  type RecorderDeps,
  type SegmentRecorderHandle,
} from '../recording/useRecorder';
import type { Settings } from '../settings/settingsStore';
import { createFakeStream } from './media';

export const CONFIGURED: Settings = { apiBaseUrl: 'https://api.test', accessKey: 'key-1' };

/** Stands in for SegmentRecorder; tests push segments and microphone readings through it by hand. */
export class FakeSegmentRecorder implements SegmentRecorderHandle {
  started = false;
  /** Runs inside stop(), e.g. to deliver the last segment like the real recorder does. */
  onStop: (() => void) | undefined;
  readonly stop = vi.fn(async () => {
    this.onStop?.();
  });

  constructor(readonly options: SegmentRecorderOptions) {}

  start(): void {
    this.started = true;
  }

  emit(seq: number): void {
    this.options.onSegment({ seq, blob: new Blob([`audio-${seq}`], { type: 'audio/webm;codecs=opus' }) });
  }

  /** One microphone reading, as the real recorder reports about every 100ms. */
  level(rms: number): void {
    this.options.onLevel?.(rms);
  }

  interrupt(): void {
    this.options.onInterrupted();
  }
}

export interface PendingCall {
  input: TranscribeInput;
  resolve(text: string): void;
  reject(error: unknown): void;
}

/** An ApiClient whose transcribe() calls wait until the test resolves or rejects them. */
export function createFakeClient() {
  const calls: PendingCall[] = [];
  const transcribe = vi.fn(
    (input: TranscribeInput) =>
      new Promise<TranscribeResponse>((resolve, reject) => {
        calls.push({ input, resolve: (text) => resolve({ seq: input.seq, text }), reject });
      }),
  );
  const client: ApiClient = { health: vi.fn(async () => true), transcribe };
  return { client, transcribe, calls };
}

/** Lets pending promise chains (upload → insert) run, inside act(). */
export const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** A real editor with the app's extensions (TranscriptGap included), destroyed when the test ends. */
export function createTestEditor(content = '<p></p>'): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: createExtensions(),
    content,
  });
  onTestFinished(() => {
    // A test may already have destroyed it, e.g. to act out switching to another note.
    if (!editor.isDestroyed) editor.destroy();
  });
  return editor;
}

/** Props of the rendered hook; `rerender` takes the same shape. */
export interface RecorderProps {
  settings: Settings;
  /** Defaults to the editor setupRecorder created; NotesApp passes a new editor per note. */
  editor?: Editor;
  /** Defaults to 'n1'. */
  noteId?: string;
}

/**
 * Renders useRecorder against a real editor and a fresh fake IndexedDB, with every outside
 * dependency replaced by a fake. `rerender({ settings, editor?, noteId? })` changes the props,
 * e.g. a new editor and noteId when the user opens another note.
 */
export async function setupRecorder(options: { settings?: Settings; content?: string } = {}) {
  const editor = createTestEditor(options.content);
  const db = await openAppDb(`test-${crypto.randomUUID()}`);
  const media = createFakeStream();
  const recorders: FakeSegmentRecorder[] = [];
  const fake = createFakeClient();
  /** What deps.now() returns; tests move it by hand. */
  const clock = { now: 0 };
  let gaps = 0;
  const deps = {
    getUserMedia: vi.fn(async () => media.stream),
    createRecorder: vi.fn((recorderOptions: SegmentRecorderOptions) => {
      const recorder = new FakeSegmentRecorder(recorderOptions);
      recorders.push(recorder);
      return recorder;
    }),
    createClient: vi.fn((_settings: Settings) => fake.client),
    pickMimeType: () => 'audio/webm;codecs=opus',
    sleep: vi.fn(async (_ms: number) => undefined),
    newGapId: () => `gap-${++gaps}`,
    now: vi.fn(() => clock.now),
  } satisfies RecorderDeps;
  const onUnauthorized = vi.fn();
  // Typed as RecorderProps so that rerender() accepts editor and noteId too.
  const initialProps: RecorderProps = { settings: options.settings ?? CONFIGURED };
  const hook = renderHook(
    ({ settings, editor: current = editor, noteId = 'n1' }: RecorderProps) =>
      useRecorder({ editor: current, noteId, settings, db, onUnauthorized, deps }),
    { initialProps },
  );
  return {
    ...hook,
    editor,
    db,
    deps,
    clock,
    recorders,
    onUnauthorized,
    stream: media.stream,
    track: media.track,
    ...fake,
  };
}
