import type { Note } from '@oc/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackup, serializeBackup } from './backup/backupFormat';
import { NotesApp } from './NotesApp';
import { openAppDb } from './platform/db';
import { PlatformProvider } from './platform/PlatformContext';
import { createPendingQueue } from './recording/pendingQueue';
import { createFakeStream, FakeMediaRecorder } from './test/media';
import { createTestPlatform } from './test/memoryStorage';

const SETTINGS = { apiBaseUrl: 'https://api.test', accessKey: 'key-1' };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Fake microphone: navigator.mediaDevices + MediaRecorder (jsdom has neither, nor AudioContext). */
function installMicrophone() {
  const media = createFakeStream();
  const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => media.stream);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  FakeMediaRecorder.reset();
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  return { ...media, getUserMedia };
}

/** Fake backend behind fetch: /transcribe answers with respond(seq). */
function installBackend(respond: (seq: number) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/health')) return json({ ok: true });
    return respond(Number((init?.body as FormData).get('seq')));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderApp({ configured = true, notes = [] }: { configured?: boolean; notes?: Note[] } = {}) {
  if (configured) localStorage.setItem('oc.settings', JSON.stringify(SETTINGS));
  const ctx = createTestPlatform(notes);
  render(
    <PlatformProvider platform={ctx.platform}>
      <NotesApp />
    </PlatformProvider>,
  );
  await screen.findByRole('textbox', { name: '標題' });
  return { ...ctx, user: userEvent.setup() };
}

const body = () => screen.getByRole('textbox', { name: '筆記內文' });
const button = (name: string) => screen.getByRole('button', { name });

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

const backupFile = (notes: Note[]) =>
  new File([serializeBackup(createBackup(notes, 5_000))], 'backup.json', { type: 'application/json' });
const chooseFile = (file: File) =>
  fireEvent.change(screen.getByLabelText('選擇備份檔'), { target: { files: [file] } });
const textNote = (id: string, title: string, text: string, updatedAt: number): Note => ({
  id,
  title,
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  createdAt: updatedAt,
  updatedAt,
});

describe('NotesApp recording and import', () => {
  it('cannot start recording while an import is writing, and records into the reloaded note after it', async () => {
    const mic = installMicrophone();
    installBackend((seq) => json({ seq, text: '你好世界' }));
    const { user, storage } = await renderApp({ notes: [textNote('a', '週會', '舊內容', 1_000)] });
    let release!: () => void;
    storage.put.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    chooseFile(backupFile([textNote('a', '週會', '新內容', 2_000)]));
    await waitFor(() => expect(storage.put).toHaveBeenCalledTimes(1));

    expect(button('錄製')).toBeDisabled();
    fireEvent.click(button('錄製'));
    expect(mic.getUserMedia).not.toHaveBeenCalled();

    release();
    expect(await screen.findByText('已匯入 1 篇，略過 0 篇（本機版本較新）')).toBeInTheDocument();
    await waitFor(() => expect(body()).toHaveTextContent('新內容'));
    expect(button('錄製')).toBeEnabled();

    await user.click(button('錄製'));
    await user.click(await screen.findByRole('button', { name: '停止' }));
    expect(await screen.findByRole('button', { name: '錄製' })).toBeEnabled();
    expect(body()).toHaveTextContent('你好世界');
  });

  it('locks backup and import while the microphone prompt is open', async () => {
    const mic = installMicrophone();
    installBackend((seq) => json({ seq, text: '你好世界' }));
    const { user } = await renderApp();
    let allow!: () => void;
    mic.getUserMedia.mockImplementationOnce(
      () =>
        new Promise<MediaStream>((resolve) => {
          allow = () => resolve(mic.stream);
        }),
    );

    await user.click(button('錄製'));

    await waitFor(() => expect(mic.getUserMedia).toHaveBeenCalledTimes(1));
    expect(button('備份')).toBeDisabled();
    expect(button('匯入')).toBeDisabled();
    expect(button('新增筆記')).toBeDisabled();

    allow();
    expect(await screen.findByRole('button', { name: '停止' })).toBeEnabled();
    await user.click(button('停止'));
    expect(await screen.findByRole('button', { name: '錄製' })).toBeEnabled();
    expect(button('匯入')).toBeEnabled();
  });

  it('unlocks backup and import when the microphone is denied', async () => {
    const mic = installMicrophone();
    const { user } = await renderApp();
    mic.getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));

    await user.click(button('錄製'));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(button('匯入')).toBeEnabled();
    expect(button('備份')).toBeEnabled();
  });
});

describe('NotesApp recording', () => {
  it('asks for a backend first and saves it from the settings dialog', async () => {
    const { user } = await renderApp({ configured: false });

    await user.click(button('請先設定'));
    const dialog = screen.getByRole('dialog', { name: '設定' });
    await user.type(within(dialog).getByLabelText('後端網址'), 'https://api.test/');
    await user.type(within(dialog).getByLabelText('存取金鑰'), 'key-1');
    await user.click(within(dialog).getByRole('button', { name: '儲存' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button('錄製')).toBeEnabled();
    expect(JSON.parse(localStorage.getItem('oc.settings') ?? '')).toEqual(SETTINGS);
  });

  it('opens the settings from the gear button with the saved values', async () => {
    const { user } = await renderApp();
    await user.click(button('設定'));
    expect(screen.getByLabelText('後端網址')).toHaveValue('https://api.test');
    await user.click(button('取消'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('records into the note and locks the note list until the transcript is in', async () => {
    const mic = installMicrophone();
    const fetchMock = installBackend((seq) => json({ seq, text: '你好世界' }));
    const { user } = await renderApp();

    await user.click(button('錄製'));
    expect(await screen.findByRole('button', { name: '停止' })).toBeEnabled();
    expect(mic.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(button('新增筆記')).toBeDisabled();
    expect(screen.getByRole('button', { name: /^未命名筆記/ })).toBeDisabled();
    expect(button('備份')).toBeDisabled();
    expect(button('匯入')).toBeDisabled();

    await user.click(button('停止'));

    expect(await screen.findByRole('button', { name: '錄製' })).toBeEnabled();
    expect(body()).toHaveTextContent('你好世界');
    expect(button('新增筆記')).toBeEnabled();
    expect(button('備份')).toBeEnabled();
    expect(button('匯入')).toBeEnabled();
    expect(mic.track.stop).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.test/transcribe');
    expect(init?.headers).toEqual({ Authorization: 'Bearer key-1' });
  });

  it('a rejected key opens the settings and leaves a gap that a click retries', async () => {
    installMicrophone();
    let accepted = false;
    const fetchMock = installBackend((seq) =>
      accepted ? json({ seq, text: '補上了' }) : json({ error: 'unauthorized' }, 401),
    );
    const { user } = await renderApp();

    await user.click(button('錄製'));
    await user.click(await screen.findByRole('button', { name: '停止' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('存取金鑰錯誤，請重新設定');
    const dialog = await screen.findByRole('dialog', { name: '設定' });
    const gap = await screen.findByText('⚠ 第 1 段未轉寫・重試');
    expect(button('錄製')).toBeEnabled();

    const key = within(dialog).getByLabelText('存取金鑰');
    await user.clear(key);
    await user.type(key, 'key-2');
    await user.click(within(dialog).getByRole('button', { name: '儲存' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    accepted = true;
    // fireEvent, not user.click: the mousedown user-event sends first makes ProseMirror call
    // document.elementFromPoint, which jsdom does not have. The retry only needs the click.
    fireEvent.click(gap);

    await waitFor(() => expect(body()).toHaveTextContent('補上了'));
    expect(screen.queryByText('⚠ 第 1 段未轉寫・重試')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.at(-1)?.[1]?.headers).toEqual({ Authorization: 'Bearer key-2' });
  });

  it('Enter on a selected gap marker retries it, so the keyboard can reach the retry', async () => {
    installMicrophone();
    let accepted = false;
    const fetchMock = installBackend((seq) =>
      accepted ? json({ seq, text: '鍵盤補上' }) : json({ error: 'unauthorized' }, 401),
    );
    const { user } = await renderApp();
    await user.click(button('錄製'));
    await user.click(await screen.findByRole('button', { name: '停止' }));
    await screen.findByText('⚠ 第 1 段未轉寫・重試');
    const dialog = await screen.findByRole('dialog', { name: '設定' });
    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    accepted = true;
    const sent = fetchMock.mock.calls.length;

    // Enter in the title still moves to the body instead of retrying.
    screen.getByRole('textbox', { name: '標題' }).focus();
    await user.keyboard('{Enter}');
    expect(fetchMock).toHaveBeenCalledTimes(sent);

    // The cursor is at the start, in front of the marker; ArrowRight selects it (it is an atom).
    // fireEvent with keyCode 39, as browsers send it, so ProseMirror's own arrow handling selects
    // the marker. user-event's {ArrowRight} has no keyCode: it only moves the DOM selection, which
    // ProseMirror reads back later, and under load that raced with focus handling and with Enter.
    expect(document.activeElement).toBe(body());
    fireEvent.keyDown(body(), { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 });
    expect(screen.getByText('⚠ 第 1 段未轉寫・重試')).toHaveClass('ProseMirror-selectednode');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(body()).toHaveTextContent('鍵盤補上'));
    expect(screen.queryByText('⚠ 第 1 段未轉寫・重試')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(sent + 1);
  });

  it('shows a refused microphone in an alert that can be dismissed', async () => {
    const mic = installMicrophone();
    mic.getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    const { user } = await renderApp();

    await user.click(button('錄製'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法使用麥克風，請在系統或瀏覽器設定中允許麥克風權限',
    );
    expect(button('錄製')).toBeEnabled();
    await user.click(button('關閉訊息'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('deleting a note also drops the audio kept for its untranscribed segments', async () => {
    // NotesApp's recording queue uses the app database 'open-copilot' (fake-indexeddb here).
    const queue = createPendingQueue(openAppDb());
    const audio = { seq: 1, blob: new Blob(['x']), mimeType: 'audio/webm', prompt: '' };
    await queue.add({ ...audio, gapId: 'gap-of-deleted-note', noteId: 'with-gap' });
    await queue.add({ ...audio, gapId: 'gap-of-other-note', noteId: 'other' });
    const withGap: Note = {
      id: 'with-gap',
      title: '有標記',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '前' },
              { type: 'transcriptGap', attrs: { gapId: 'gap-of-deleted-note', seq: 1 } },
            ],
          },
        ],
      },
      createdAt: 2,
      updatedAt: 2,
    };
    // Its own marker keeps its audio from the load-time pruneAudio().
    const other: Note = {
      id: 'other',
      title: '其他',
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'transcriptGap', attrs: { gapId: 'gap-of-other-note', seq: 1 } }] },
        ],
      },
      createdAt: 1,
      updatedAt: 1,
    };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, storage } = await renderApp({ notes: [withGap, other] });
    expect(await screen.findByText('⚠ 第 1 段未轉寫・重試')).toBeInTheDocument();

    await user.click(button('刪除「有標記」'));

    await waitFor(() => expect(storage.remove).toHaveBeenCalledWith('with-gap'));
    await waitFor(async () => expect(await queue.get('gap-of-deleted-note')).toBeUndefined());
    expect(await queue.get('gap-of-other-note')).toBeDefined();
  });
});
