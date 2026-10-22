import type { JSONContent, Note } from '@oc/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotesApp } from './NotesApp';
import { PlatformProvider } from './platform/PlatformContext';
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
});

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
    expect(screen.getByRole('button', { name: '關閉筆記清單' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    await user.click(within(list()).getByRole('button', { name: /^A/ }));
    expect(app).toHaveAttribute('data-drawer-open', 'false');
  });
});
