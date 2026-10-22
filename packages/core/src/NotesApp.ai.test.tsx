import type { Note } from '@oc/shared';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_DISABLED_REASONS, AI_MESSAGES } from './ai/aiMessages';
import { AI_PRIVACY_KEY } from './ai/aiPrivacy';
import { NotesApp } from './NotesApp';
import { PlatformProvider } from './platform/PlatformContext';
import { createTestPlatform } from './test/memoryStorage';

const SETTINGS = { apiBaseUrl: 'https://api.test', accessKey: 'key-1' };
const BODY_TEXT = '下週三前要寄出報價單。';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const textNote = (text: string): Note => ({
  id: 'n1',
  title: '週會',
  content: {
    type: 'doc',
    content: [text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' }],
  },
  createdAt: 1,
  updatedAt: 1,
});

/** Fake backend behind fetch: each path answers with the next response of its list. */
function installBackend(routes: Record<string, Response[]>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = String(input).replace(SETTINGS.apiBaseUrl, '');
    const next = routes[path]?.shift();
    if (!next) throw new Error(`unexpected request ${path}`);
    return next;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderApp({
  configured = true,
  acknowledged = false,
  note = textNote(BODY_TEXT),
}: { configured?: boolean; acknowledged?: boolean; note?: Note } = {}) {
  if (configured) localStorage.setItem('oc.settings', JSON.stringify(SETTINGS));
  if (acknowledged) localStorage.setItem(AI_PRIVACY_KEY, '1');
  const ctx = createTestPlatform([note]);
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
});

describe('NotesApp AI', () => {
  it('asks once about Groq, then shows the summary and inserts it at the top of the note', async () => {
    const fetchMock = installBackend({
      '/ai/summary': [json({ summary: '決定下週三前寄出報價單。' }), json({ summary: '第二次' })],
    });
    const { user } = await renderApp();

    await user.click(button('AI 摘要'));
    const notice = screen.getByRole('dialog', { name: 'AI 功能說明' });
    expect(notice).toHaveTextContent('筆記內容會送到 Groq 處理');
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(within(notice).getByRole('button', { name: '我知道了' }));
    expect(localStorage.getItem(AI_PRIVACY_KEY)).toBe('1');

    const panel = await screen.findByRole('complementary', { name: 'AI 摘要' });
    await within(panel).findByText('決定下週三前寄出報價單。');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.test/ai/summary');
    expect(JSON.parse(String(init?.body))).toEqual({ title: '週會', text: BODY_TEXT });

    await user.click(within(panel).getByRole('button', { name: '插入到筆記開頭' }));
    expect(screen.queryByRole('complementary', { name: 'AI 摘要' })).not.toBeInTheDocument();
    const paragraphs = body().querySelectorAll('p');
    expect(paragraphs[0]).toHaveTextContent('決定下週三前寄出報價單。');
    expect(paragraphs[1]).toHaveTextContent(BODY_TEXT);

    // The notice is shown only once.
    await user.click(button('AI 摘要'));
    expect(screen.queryByRole('dialog', { name: 'AI 功能說明' })).not.toBeInTheDocument();
    await within(await screen.findByRole('complementary', { name: 'AI 摘要' })).findByText('第二次');
  });

  it('sends nothing when the privacy notice is cancelled', async () => {
    const fetchMock = installBackend({});
    const { user } = await renderApp();

    await user.click(button('待辦事項'));
    await user.click(within(screen.getByRole('dialog', { name: 'AI 功能說明' })).getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: '待辦事項' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(AI_PRIVACY_KEY)).toBeNull();
  });

  it('inserts the checked todos as a task list under 待辦事項 at the end of the note', async () => {
    installBackend({ '/ai/todos': [json({ items: ['寄出報價單', '預約會議室'] })] });
    const { user } = await renderApp({ acknowledged: true });

    await user.click(button('待辦事項'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const panel = await screen.findByRole('complementary', { name: '待辦事項' });
    await user.click(await within(panel).findByRole('checkbox', { name: '預約會議室' }));
    await user.click(within(panel).getByRole('button', { name: '插入到筆記結尾' }));

    expect(body().querySelector('h2')).toHaveTextContent('待辦事項');
    const items = Array.from(body().querySelectorAll('ul[data-type="taskList"] > li'));
    // Tiptap's task item also holds the checkbox label text (visually hidden), so read the item's
    // content element rather than the whole <li>.
    expect(
      items.map((li) => [li.querySelector(':scope > div')?.textContent, li.querySelector('input')?.checked]),
    ).toEqual([
      ['寄出報價單', false],
      ['預約會議室', true],
    ]);
  });

  it('disables both AI buttons until a backend is configured', async () => {
    await renderApp({ configured: false });
    for (const name of ['AI 摘要', '待辦事項']) {
      expect(button(name)).toBeDisabled();
      expect(button(name)).toHaveAttribute('title', AI_DISABLED_REASONS.notConfigured);
    }
  });

  it('disables both AI buttons for an empty note', async () => {
    await renderApp({ note: textNote('') });
    for (const name of ['AI 摘要', '待辦事項']) {
      expect(button(name)).toBeDisabled();
      expect(button(name)).toHaveAttribute('title', AI_DISABLED_REASONS.empty);
    }
  });

  it('shows why the backend cannot help and retries from the panel', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installBackend({
      '/ai/summary': [json({ error: 'ai_unavailable' }, 503), json({ summary: '好了' })],
    });
    const { user } = await renderApp({ acknowledged: true });

    await user.click(button('AI 摘要'));
    const panel = await screen.findByRole('complementary', { name: 'AI 摘要' });
    expect(await within(panel).findByRole('alert')).toHaveTextContent(AI_MESSAGES.unavailable);

    await user.click(within(panel).getByRole('button', { name: '重試' }));
    // The panel is keyed on the request, so the retry shows a new one.
    await within(await screen.findByRole('complementary', { name: 'AI 摘要' })).findByText('好了');
  });

  it('retries with the note as it is now, not as it was on the first request', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = installBackend({
      '/ai/summary': [json({ error: 'ai_unavailable' }, 503), json({ summary: '好了' })],
    });
    const { user } = await renderApp({ acknowledged: true });

    await user.click(button('AI 摘要'));
    const panel = await screen.findByRole('complementary', { name: 'AI 摘要' });
    await within(panel).findByRole('alert');

    // jsdom cannot place a click in ProseMirror, so edit through the editor Tiptap hangs on its element.
    const { editor } = body() as HTMLElement & { editor: TiptapEditor };
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size, '<p>再補一句。</p>');
    });
    await waitFor(() => expect(body()).toHaveTextContent('再補一句。'));
    await user.click(within(screen.getByRole('complementary', { name: 'AI 摘要' })).getByRole('button', { name: '重試' }));

    await within(await screen.findByRole('complementary', { name: 'AI 摘要' })).findByText('好了');
    const [, init] = fetchMock.mock.calls[1]!;
    expect(JSON.parse(String(init?.body)).text).toContain('再補一句。');
  });

  it('opens the settings when the access key is rejected', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installBackend({ '/ai/todos': [json({ error: 'unauthorized' }, 401)] });
    const { user } = await renderApp({ acknowledged: true });

    await user.click(button('待辦事項'));

    expect(await screen.findByRole('dialog', { name: '設定' })).toBeInTheDocument();
    const panel = screen.getByRole('complementary', { name: '待辦事項' });
    expect(within(panel).getByRole('alert')).toHaveTextContent(AI_MESSAGES.unauthorized);
  });

  it('closes the panel when another note is opened', async () => {
    installBackend({ '/ai/summary': [json({ summary: '摘要' })] });
    const { user } = await renderApp({ acknowledged: true });

    await user.click(button('AI 摘要'));
    await within(await screen.findByRole('complementary', { name: 'AI 摘要' })).findByText('摘要');
    await user.click(button('新增筆記'));

    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'AI 摘要' })).not.toBeInTheDocument(),
    );
  });
});
