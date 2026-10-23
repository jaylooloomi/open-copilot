import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NotesApp } from './NotesApp';
import { PlatformProvider } from './platform/PlatformContext';
import { createTestPlatform } from './test/memoryStorage';

const openAppDb = vi.hoisted(() => vi.fn());
vi.mock('./platform/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./platform/db')>();
  openAppDb.mockImplementation(actual.openAppDb);
  return { ...actual, openAppDb };
});

async function renderApp() {
  const ctx = createTestPlatform([]);
  const view = render(
    <StrictMode>
      <PlatformProvider platform={ctx.platform}>
        <NotesApp />
      </PlatformProvider>
    </StrictMode>,
  );
  await screen.findByRole('textbox', { name: '標題' });
  return view;
}

describe('NotesApp recording database', () => {
  it('opens one connection for the page, not one per render or mount', async () => {
    const first = await renderApp();
    first.unmount();
    await renderApp();

    // StrictMode runs state initializers twice; neither that nor a remount opens another one.
    expect(openAppDb).toHaveBeenCalledTimes(1);
  });
});
