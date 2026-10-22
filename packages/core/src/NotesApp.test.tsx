import type { JSONContent, Note } from '@oc/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotesApp } from './NotesApp';
import { PlatformProvider } from './platform/PlatformContext';
import { readBlobText } from './test/blob';
import { createTestPlatform } from './test/memoryStorage';

const doc = (text: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const note = (id: string, title: string, text: string, updatedAt: number): Note => ({
  id,
  title,
  content: doc(text),
  createdAt: updatedAt,
  updatedAt,
});

async function renderApp(initial: Note[] = []) {
  const ctx = createTestPlatform(initial);
  render(
    <PlatformProvider platform={ctx.platform}>
      <NotesApp />
    </PlatformProvider>,
  );
  await screen.findByRole('textbox', { name: '標題' });
  return { ...ctx, user: userEvent.setup() };
}

const titleInput = () => screen.getByRole('textbox', { name: '標題' });
const body = () => screen.getByRole('textbox', { name: '筆記內文' });
const list = () => screen.getByRole('list', { name: '筆記清單' });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Collects unhandled promise rejections until the returned stop() is called. */
function watchUnhandledRejections() {
  const reasons: unknown[] = [];
  const onUnhandled = (reason: unknown) => reasons.push(reason);
  process.on('unhandledRejection', onUnhandled);
  return {
    reasons,
    async stop() {
      // Unhandled rejections are reported after the microtask queue drains.
      await new Promise((resolve) => setTimeout(resolve, 20));
      process.off('unhandledRejection', onUnhandled);
    },
  };
}

describe('NotesApp', () => {
  it('starts with one empty note when storage is empty', async () => {
    await renderApp();
    expect(titleInput()).toHaveValue('');
    expect(titleInput()).toHaveAttribute('placeholder', '請輸入標題..');
    expect(within(list()).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list()).getByText('未命名筆記')).toBeInTheDocument();
  });

  it('renders the action bar, banner and toolbar', async () => {
    await renderApp();
    expect(screen.getByRole('button', { name: '錄製' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'AI 摘要' })).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent('手動輸入累了？');
    expect(screen.getByRole('toolbar', { name: '格式工具列' })).toBeInTheDocument();
  });

  it('shows a typed title in the list and saves it', async () => {
    const { user, storage } = await renderApp();
    await user.type(titleInput(), '週會');

    expect(within(list()).getByRole('button', { name: /^週會/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(storage.put).toHaveBeenLastCalledWith(expect.objectContaining({ title: '週會' })),
    );
  });

  it('creates a new note and makes it active', async () => {
    const { user } = await renderApp([note('a', 'A', 'Alpha', 1)]);
    await user.click(screen.getByRole('button', { name: '新增筆記' }));

    await waitFor(() => expect(within(list()).getAllByRole('listitem')).toHaveLength(2));
    expect(titleInput()).toHaveValue('');
    expect(body()).not.toHaveTextContent('Alpha');
    // Ready to type the new note's title.
    await waitFor(() => expect(titleInput()).toHaveFocus());
  });

  it('reports a failed autosave and clears it once a later save succeeds', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user, storage, notes } = await renderApp([note('a', 'A', 'Alpha', 1)]);
    storage.put.mockRejectedValueOnce(new Error('quota'));

    await user.type(titleInput(), '1');
    expect(await screen.findByRole('alert', {}, { timeout: 2000 })).toHaveTextContent(
      '筆記儲存失敗',
    );
    expect(consoleError).toHaveBeenCalledWith('Failed to save note', expect.any(Error));
    expect(notes.get('a')?.title).toBe('A');

    // The next edit writes the unsaved change too, and the alert goes away.
    await user.type(titleInput(), '2');
    await waitFor(() => expect(notes.get('a')?.title).toBe('A12'), { timeout: 2000 });
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('shows an error with a retry button when the notes cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ctx = createTestPlatform([note('a', 'A', 'Alpha', 1)]);
    ctx.storage.list.mockRejectedValueOnce(new Error('idb closed'));
    render(
      <PlatformProvider platform={ctx.platform}>
        <NotesApp />
      </PlatformProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('無法載入筆記');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByRole('textbox', { name: '標題' })).toHaveValue('A');
  });

  it('switches between notes', async () => {
    const { user } = await renderApp([note('a', 'A', 'Alpha', 1), note('b', 'B', 'Beta', 2)]);
    expect(titleInput()).toHaveValue('B');
    expect(body()).toHaveTextContent('Beta');

    await user.click(within(list()).getByRole('button', { name: /^A/ }));

    expect(titleInput()).toHaveValue('A');
    expect(body()).toHaveTextContent('Alpha');
  });

  it('toolbar reflects the newly selected note', async () => {
    const a: Note = {
      id: 'a',
      title: 'A',
      createdAt: 1,
      updatedAt: 1,
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Alpha' }] },
        ],
      },
    };
    const { user } = await renderApp([a, note('b', 'B', 'Beta', 2)]);

    await user.click(screen.getByRole('button', { name: '項目清單' }));
    expect(screen.getByRole('button', { name: '項目清單' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(list()).getByRole('button', { name: /^A/ }));

    expect(screen.getByRole('combobox', { name: '段落樣式' })).toHaveValue('h1');
    expect(screen.getByRole('button', { name: '項目清單' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '復原' })).toBeDisabled();
  });

  it('deletes a note only after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { user, storage } = await renderApp([
      note('a', 'A', 'Alpha', 1),
      note('b', 'B', 'Beta', 2),
    ]);

    await user.click(screen.getByRole('button', { name: '刪除「B」' }));
    expect(confirm).toHaveBeenLastCalledWith('確定要刪除「B」嗎？此動作無法復原。');
    expect(storage.remove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '刪除「B」' }));
    await waitFor(() => expect(within(list()).getAllByRole('listitem')).toHaveLength(1));
    expect(storage.remove).toHaveBeenCalledWith('b');
    expect(titleInput()).toHaveValue('A');
  });

  it('moves focus to the body when Enter is pressed in the title', async () => {
    const { user } = await renderApp();
    await user.type(titleInput(), '標題{Enter}');
    await waitFor(() => expect(body()).toHaveFocus());
  });

  it('opens and closes the note drawer from the menu button', async () => {
    const { user } = await renderApp([note('a', 'A', 'Alpha', 1), note('b', 'B', 'Beta', 2)]);
    const app = document.querySelector('.oc-app');
    expect(app).toHaveAttribute('data-drawer-open', 'false');

    await user.click(screen.getByRole('button', { name: '開啟筆記清單' }));
    expect(app).toHaveAttribute('data-drawer-open', 'true');
    expect(
      within(screen.getByRole('main')).getByRole('button', { name: '關閉筆記清單' }),
    ).toHaveAttribute('aria-expanded', 'true');

    await user.click(within(list()).getByRole('button', { name: /^A/ }));
    expect(app).toHaveAttribute('data-drawer-open', 'false');
  });

  it('keeps the note and reports the failure when deleting it fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user, storage } = await renderApp([
      note('a', 'A', 'Alpha', 1),
      note('b', 'B', 'Beta', 2),
    ]);
    storage.remove.mockRejectedValueOnce(new Error('idb fail'));
    const watch = watchUnhandledRejections();

    await user.click(screen.getByRole('button', { name: '刪除「B」' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('刪除筆記失敗');
    await watch.stop();
    expect(watch.reasons).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith('Failed to delete note', expect.any(Error));
    expect(within(list()).getAllByRole('listitem')).toHaveLength(2);
    expect(titleInput()).toHaveValue('B');

    await user.click(screen.getByRole('button', { name: '關閉錯誤訊息' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a failed save, not a failed delete, when only storing the replacement note fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user, storage, notes } = await renderApp([note('a', 'A', 'Alpha', 1)]);
    storage.put.mockRejectedValueOnce(new Error('quota'));
    const watch = watchUnhandledRejections();

    await user.click(screen.getByRole('button', { name: '刪除「A」' }));

    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith('Failed to save note', expect.any(Error)),
    );
    await watch.stop();
    expect(watch.reasons).toEqual([]);
    expect(notes.has('a')).toBe(false);
    expect(await screen.findByRole('alert')).toHaveTextContent('筆記儲存失敗');
    expect(screen.getByRole('alert')).not.toHaveTextContent('刪除筆記失敗');
    expect(within(list()).getAllByRole('listitem')).toHaveLength(1);
    expect(titleInput()).toHaveValue('');
  });

  it('reports the failure when creating a note fails, and clears it on a successful retry', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user, storage } = await renderApp([note('a', 'A', 'Alpha', 1)]);
    storage.put.mockRejectedValueOnce(new Error('quota'));
    const watch = watchUnhandledRejections();

    await user.click(screen.getByRole('button', { name: '新增筆記' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('新增筆記失敗');
    await watch.stop();
    expect(watch.reasons).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith('Failed to create note', expect.any(Error));
    expect(within(list()).getAllByRole('listitem')).toHaveLength(1);
    expect(titleInput()).toHaveValue('A');

    await user.click(screen.getByRole('button', { name: '新增筆記' }));
    await waitFor(() => expect(within(list()).getAllByRole('listitem')).toHaveLength(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // jsdom and user-event ignore `inert`, so this only checks that <main> gets the attribute; the
  // real Tab trap is covered by the narrow-screen browser e2e.
  it('moves focus into the open drawer, makes the page inert, and closes on Escape', async () => {
    const { user } = await renderApp([note('a', 'A', 'Alpha', 1), note('b', 'B', 'Beta', 2)]);
    const app = document.querySelector('.oc-app');
    const main = screen.getByRole('main');
    expect(main).not.toHaveAttribute('inert');

    await user.click(screen.getByRole('button', { name: '開啟筆記清單' }));

    // Focus lands on the active note, and the page behind the drawer is marked inert.
    expect(within(list()).getByRole('button', { name: /^B/ })).toHaveFocus();
    expect(main).toHaveAttribute('inert');

    await user.keyboard('{Escape}');

    expect(app).toHaveAttribute('data-drawer-open', 'false');
    expect(main).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: '開啟筆記清單' })).toHaveFocus();
  });

  it('returns focus to the menu button when a note is chosen from the drawer', async () => {
    const { user } = await renderApp([note('a', 'A', 'Alpha', 1), note('b', 'B', 'Beta', 2)]);

    await user.click(screen.getByRole('button', { name: '開啟筆記清單' }));
    await user.keyboard('{Tab}{Tab}{Enter}');

    expect(titleInput()).toHaveValue('A');
    expect(document.querySelector('.oc-app')).toHaveAttribute('data-drawer-open', 'false');
    expect(screen.getByRole('button', { name: '開啟筆記清單' })).toHaveFocus();
  });

  it('offers screen reader users a dismiss button inside the open drawer', async () => {
    const { user } = await renderApp([note('a', 'A', 'Alpha', 1)]);
    const sidebar = () => document.getElementById('oc-sidebar') as HTMLElement;
    expect(
      within(sidebar()).queryByRole('button', { name: '關閉筆記清單' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '開啟筆記清單' }));
    // Same name as the menu button, which is out of reach behind the inert page.
    const dismiss = within(sidebar()).getByRole('button', { name: '關閉筆記清單' });
    // Keyboard users close with Escape; the button stays out of the Tab order.
    expect(dismiss).toHaveAttribute('tabindex', '-1');

    await user.click(dismiss);
    expect(document.querySelector('.oc-app')).toHaveAttribute('data-drawer-open', 'false');
  });

  it('closes the drawer when the window grows past the drawer breakpoint', async () => {
    const listeners = new Set<() => void>();
    const query = {
      matches: true,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    };
    const matchMedia = vi.fn(() => query);
    vi.stubGlobal('matchMedia', matchMedia);
    const { user } = await renderApp([note('a', 'A', 'Alpha', 1)]);

    await user.click(screen.getByRole('button', { name: '開啟筆記清單' }));
    expect(matchMedia).toHaveBeenCalledWith('(max-width: 767.98px)');
    expect(screen.getByRole('main')).toHaveAttribute('inert');

    act(() => {
      query.matches = false;
      for (const listener of listeners) listener();
    });

    expect(document.querySelector('.oc-app')).toHaveAttribute('data-drawer-open', 'false');
    expect(screen.getByRole('main')).not.toHaveAttribute('inert');
    expect(listeners.size).toBe(0);
  });

  it('exports the active note, with its latest title, as Markdown', async () => {
    const { user, fileSaver } = await renderApp([note('a', 'A', 'Alpha', 1)]);
    await user.clear(titleInput());
    await user.type(titleInput(), '週會');

    await user.click(screen.getByRole('button', { name: '匯出' }));
    await user.click(screen.getByRole('menuitem', { name: 'Markdown' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已匯出 Markdown'));
    expect(fileSaver.save).toHaveBeenCalledTimes(1);
    const [filename, blob] = fileSaver.save.mock.calls[0];
    expect(filename).toBe('週會.md');
    expect(await readBlobText(blob)).toBe('# 週會\n\nAlpha\n');
  });
});
