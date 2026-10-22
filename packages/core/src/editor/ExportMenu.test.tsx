import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExportMenu } from './ExportMenu';

function setup(canPrint = true) {
  const onSelect = vi.fn();
  render(
    <div>
      <ExportMenu canPrint={canPrint} onSelect={onSelect} />
      <p>outside</p>
    </div>,
  );
  return { onSelect, user: userEvent.setup(), button: screen.getByRole('button', { name: '匯出' }) };
}

const itemNames = () => screen.getAllByRole('menuitem').map((item) => item.textContent);

describe('ExportMenu', () => {
  it('starts closed', () => {
    const { button } = setup();
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens a menu of Markdown, Word, 純文字 and PDF with the first item focused', async () => {
    const { user, button } = setup();
    await user.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: '匯出格式' })).toBeInTheDocument();
    expect(itemNames()).toEqual(['Markdown', 'Word', '純文字', 'PDF']);
    expect(screen.getByRole('menuitem', { name: 'Markdown' })).toHaveFocus();
  });

  it('hides PDF when the platform cannot print', async () => {
    const { user, button } = setup(false);
    await user.click(button);
    expect(itemNames()).toEqual(['Markdown', 'Word', '純文字']);
  });

  it('reports the chosen format, closes and returns focus to the button', async () => {
    const { user, button, onSelect } = setup();
    await user.click(button);
    await user.click(screen.getByRole('menuitem', { name: 'Word' }));

    expect(onSelect).toHaveBeenCalledWith('docx');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('moves with the arrow keys and selects with Enter', async () => {
    const { user, button, onSelect } = setup();
    await user.click(button);

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Word' })).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'PDF' })).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: '純文字' })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('txt');
  });

  it('closes on Escape, Tab and an outside click without choosing', async () => {
    const { user, button, onSelect } = setup();
    await user.click(button);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    await user.click(button);
    await user.tab();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(button);
    await user.click(screen.getByText('outside'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('jumps to the first and last item with Home and End', async () => {
    const { user, button } = setup();
    await user.click(button);

    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'PDF' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: 'Markdown' })).toHaveFocus();
  });

  it('closes when focus leaves the menu without a click or Tab', async () => {
    const { user, button, onSelect } = setup();
    await user.click(button);

    // e.g. focus moving into the editor iframe or another window: relatedTarget is null.
    act(() => {
      fireEvent.blur(screen.getByRole('menuitem', { name: 'Markdown' }), { relatedTarget: null });
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('stays open while focus moves between its own items', async () => {
    const { user, button } = setup();
    await user.click(button);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '純文字' })).toHaveFocus();
  });
});
