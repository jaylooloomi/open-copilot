import { EMPTY_DOC, type Note } from '@oc/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotesApp } from './NotesApp';
import { PlatformProvider } from './platform/PlatformContext';
import { createTestPlatform } from './test/memoryStorage';

// The queue cleanup after a delete must never surface as an unhandled rejection, even if
// building the queue itself throws synchronously.
const queueBroken = vi.hoisted(() => ({ value: false }));
vi.mock('./recording/pendingQueue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./recording/pendingQueue')>();
  return {
    ...actual,
    createPendingQueue: (...args: Parameters<typeof actual.createPendingQueue>) => {
      if (queueBroken.value) throw new Error('queue unavailable');
      return actual.createPendingQueue(...args);
    },
  };
});

afterEach(() => {
  queueBroken.value = false;
  vi.restoreAllMocks();
});

describe('NotesApp delete cleanup', () => {
  it('logs instead of rejecting when the pending queue cannot be built', async () => {
    const note: Note = { id: 'n1', title: '待刪', content: EMPTY_DOC, createdAt: 1, updatedAt: 1 };
    const ctx = createTestPlatform([note]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      render(
        <PlatformProvider platform={ctx.platform}>
          <NotesApp />
        </PlatformProvider>,
      );
      await screen.findByRole('textbox', { name: '標題' });
      queueBroken.value = true;

      await userEvent.setup().click(screen.getByRole('button', { name: '刪除「待刪」' }));

      await waitFor(() => expect(ctx.storage.remove).toHaveBeenCalledWith('n1'));
      await waitFor(() =>
        expect(consoleError).toHaveBeenCalledWith(
          'Failed to drop the untranscribed audio of a deleted note',
          expect.any(Error),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
