import { EMPTY_DOC, type Note } from '@oc/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyNote } from '../export/copyNote';
import { exportNote } from '../export/exportNote';
import { PlatformProvider } from '../platform/PlatformContext';
import { createTestPlatform } from '../test/memoryStorage';
import { NoteActions, STATUS_CLEAR_MS } from './NoteActions';

vi.mock('../export/copyNote', () => ({ copyNote: vi.fn() }));
vi.mock('../export/exportNote', () => ({ exportNote: vi.fn() }));

const NOTE: Note = { id: 'n1', title: '週會', content: EMPTY_DOC, createdAt: 1, updatedAt: 1 };

function setup({ canPrint = true } = {}) {
  const { platform: base } = createTestPlatform();
  const platform = { ...base, canPrint };
  const view = render(
    <PlatformProvider platform={platform}>
      <NoteActions note={NOTE} />
    </PlatformProvider>,
  );
  return { platform, view, user: userEvent.setup() };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

async function exportAs(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('button', { name: '匯出' }));
  await user.click(screen.getByRole('menuitem', { name: label }));
}

afterEach(() => {
  vi.mocked(copyNote).mockReset();
  vi.mocked(exportNote).mockReset();
  vi.useRealTimers();
});

describe('NoteActions', () => {
  it('shows 複製 and 匯出 with an empty status region', () => {
    setup();
    expect(screen.getByRole('button', { name: '複製' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '匯出' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('copies the note and says so', async () => {
    vi.mocked(copyNote).mockResolvedValue();
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: '複製' }));

    expect(copyNote).toHaveBeenCalledWith(NOTE);
    expect(screen.getByRole('status')).toHaveTextContent('已複製全文');
  });

  it('reports a failed copy', async () => {
    vi.mocked(copyNote).mockRejectedValue(new Error('denied'));
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: '複製' }));

    expect(screen.getByRole('status')).toHaveTextContent('複製失敗，請再試一次');
  });

  it.each([
    ['Markdown', 'md', '已匯出 Markdown'],
    ['Word', 'docx', '已匯出 Word'],
    ['純文字', 'txt', '已匯出純文字'],
  ])('exports %s through the platform and confirms it', async (label, format, message) => {
    vi.mocked(exportNote).mockResolvedValue();
    const { user, platform } = setup();
    await exportAs(user, label);

    expect(exportNote).toHaveBeenCalledWith(NOTE, format, platform);
    expect(screen.getByRole('status')).toHaveTextContent(message);
  });

  it('starts PDF printing without a status message', async () => {
    vi.mocked(exportNote).mockResolvedValue();
    const { user, platform } = setup();
    await exportAs(user, 'PDF');

    expect(exportNote).toHaveBeenCalledWith(NOTE, 'pdf', platform);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('offers no PDF when the platform cannot print', async () => {
    const { user } = setup({ canPrint: false });
    await user.click(screen.getByRole('button', { name: '匯出' }));
    expect(screen.queryByRole('menuitem', { name: 'PDF' })).not.toBeInTheDocument();
    expect(exportNote).not.toHaveBeenCalled();
  });

  it('reports a failed export', async () => {
    vi.mocked(exportNote).mockRejectedValue(new Error('disk full'));
    const { user } = setup();
    await exportAs(user, 'Word');

    expect(screen.getByRole('status')).toHaveTextContent('匯出失敗，請再試一次');
  });

  it('stays quiet when the user cancels the save dialog', async () => {
    vi.mocked(exportNote).mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    const { user } = setup();
    await exportAs(user, 'Markdown');

    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it(`clears the message after ${STATUS_CLEAR_MS} ms`, async () => {
    vi.useFakeTimers();
    vi.mocked(copyNote).mockResolvedValue();
    setup();

    fireEvent.click(screen.getByRole('button', { name: '複製' }));
    await act(async () => {}); // let copyNote's promise settle
    expect(screen.getByRole('status')).toHaveTextContent('已複製全文');

    act(() => vi.advanceTimersByTime(STATUS_CLEAR_MS - 1));
    expect(screen.getByRole('status')).toHaveTextContent('已複製全文');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('restarts the clear timer when a second action finishes', async () => {
    vi.useFakeTimers();
    vi.mocked(copyNote).mockResolvedValue();
    setup();

    fireEvent.click(screen.getByRole('button', { name: '複製' }));
    await act(async () => {});
    act(() => vi.advanceTimersByTime(STATUS_CLEAR_MS - 1000));

    fireEvent.click(screen.getByRole('button', { name: '複製' }));
    await act(async () => {});
    act(() => vi.advanceTimersByTime(STATUS_CLEAR_MS - 1));
    expect(screen.getByRole('status')).toHaveTextContent('已複製全文');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('shows only the result of the latest action', async () => {
    const slowExport = deferred();
    vi.mocked(exportNote).mockReturnValue(slowExport.promise);
    vi.mocked(copyNote).mockResolvedValue();
    const { user } = setup();

    await exportAs(user, 'Word');
    await user.click(screen.getByRole('button', { name: '複製' }));
    expect(screen.getByRole('status')).toHaveTextContent('已複製全文');

    await act(async () => slowExport.resolve());
    expect(screen.getByRole('status')).toHaveTextContent('已複製全文');
  });

  it('schedules no timer when an action settles after unmount', async () => {
    vi.useFakeTimers();
    const slowCopy = deferred();
    vi.mocked(copyNote).mockReturnValue(slowCopy.promise);
    const { view } = setup();

    fireEvent.click(screen.getByRole('button', { name: '複製' }));
    view.unmount();
    await act(async () => slowCopy.resolve());

    expect(vi.getTimerCount()).toBe(0);
  });
});
