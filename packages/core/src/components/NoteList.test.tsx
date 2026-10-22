import { EMPTY_DOC, type Note } from '@oc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NoteList } from './NoteList';

const note = (id: string, title: string, updatedAt: number): Note => ({
  id,
  title,
  content: EMPTY_DOC,
  createdAt: updatedAt,
  updatedAt,
});

const NOTES = [note('b', '週會紀錄', 2), note('a', '', 1)];

function setup(activeId = 'b') {
  const handlers = { onSelect: vi.fn(), onCreate: vi.fn(), onDelete: vi.fn() };
  render(<NoteList notes={NOTES} activeId={activeId} {...handlers} />);
  return { ...handlers, user: userEvent.setup() };
}

describe('NoteList', () => {
  it('lists notes in the given order with 未命名筆記 for blank titles', () => {
    setup();
    const items = within(screen.getByRole('list', { name: '筆記清單' })).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('.oc-note-title')?.textContent)).toEqual([
      '週會紀錄',
      '未命名筆記',
    ]);
  });

  it('marks the active note', () => {
    setup('b');
    expect(screen.getByRole('button', { name: /^週會紀錄/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /^未命名筆記/ })).not.toHaveAttribute('aria-current');
  });

  it('selects a note', async () => {
    const { user, onSelect } = setup();
    await user.click(screen.getByRole('button', { name: /^未命名筆記/ }));
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('creates a note', async () => {
    const { user, onCreate } = setup();
    await user.click(screen.getByRole('button', { name: '新增筆記' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('deletes a note without selecting it', async () => {
    const { user, onDelete, onSelect } = setup();
    await user.click(screen.getByRole('button', { name: '刪除「週會紀錄」' }));
    expect(onDelete).toHaveBeenCalledWith('b');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
