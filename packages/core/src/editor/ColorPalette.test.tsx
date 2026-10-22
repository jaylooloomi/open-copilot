import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ColorPalette } from './ColorPalette';
import { TEXT_COLORS } from './palettes';

interface SetupOptions {
  current?: string;
  /** Rendered before the palette, e.g. a stand-in for the editor. */
  before?: ReactNode;
  /** Rendered after the palette, e.g. the next toolbar control. */
  after?: ReactNode;
}

function setup({ current, before, after }: SetupOptions = {}) {
  const onPick = vi.fn();
  const onClear = vi.fn();
  render(
    <div>
      {before}
      <ColorPalette
        label="字色"
        icon={<span>A</span>}
        colors={TEXT_COLORS}
        current={current}
        onPick={onPick}
        onClear={onClear}
      />
      {after}
      <p>outside</p>
    </div>,
  );
  return { onPick, onClear, user: userEvent.setup() };
}

const toggleButton = () => screen.getByRole('button', { name: '字色' });

describe('ColorPalette', () => {
  it('opens an 8-colour palette with a clear button', async () => {
    const { user } = setup();
    const toggle = toggleButton();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('group', { name: '字色色盤' });
    expect(within(group).getAllByRole('button')).toHaveLength(9);
    expect(within(group).getByRole('button', { name: '清除' })).toBeInTheDocument();
  });

  it('uses the disclosure pattern: no menu popup, aria-controls names the open popover', async () => {
    const { user } = setup();
    const toggle = toggleButton();
    expect(toggle).not.toHaveAttribute('aria-haspopup');
    expect(toggle).not.toHaveAttribute('aria-controls');

    await user.click(toggle);

    const group = screen.getByRole('group', { name: '字色色盤' });
    expect(group.id).not.toBe('');
    expect(toggle).toHaveAttribute('aria-controls', group.id);
  });

  it('picks a colour and closes', async () => {
    const { user, onPick } = setup();
    await user.click(toggleButton());
    await user.click(screen.getByRole('button', { name: '紅色' }));

    expect(onPick).toHaveBeenCalledWith('#dc2626');
    expect(screen.queryByRole('group', { name: '字色色盤' })).not.toBeInTheDocument();
  });

  it('clears and closes', async () => {
    const { user, onClear } = setup();
    await user.click(toggleButton());
    await user.click(screen.getByRole('button', { name: '清除' }));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group', { name: '字色色盤' })).not.toBeInTheDocument();
  });

  it('marks the current colour as pressed', async () => {
    const { user } = setup({ current: '#2563eb' });
    await user.click(toggleButton());
    expect(screen.getByRole('button', { name: '藍色' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '紅色' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('closes on Escape and on outside click', async () => {
    const { user } = setup();
    await user.click(toggleButton());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group')).not.toBeInTheDocument();

    await user.click(toggleButton());
    await user.click(screen.getByText('outside'));
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('closes when the toggle is clicked again', async () => {
    const { user } = setup();
    const toggle = toggleButton();
    await user.click(toggle);
    expect(screen.getByRole('group', { name: '字色色盤' })).toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('stays open on a click inside the popover that misses every button', async () => {
    const { user, onPick, onClear } = setup();
    await user.click(toggleButton());

    await user.click(screen.getByRole('group', { name: '字色色盤' }));

    expect(screen.getByRole('group', { name: '字色色盤' })).toBeInTheDocument();
    expect(onPick).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it('returns focus to the toggle when Escape closes the popover from a swatch', async () => {
    const { user } = setup();
    const toggle = toggleButton();
    await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.tab();
    expect(screen.getByRole('button', { name: '黑色' })).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it('returns focus to the toggle when a swatch is picked from the keyboard', async () => {
    const { user, onPick } = setup();
    const toggle = toggleButton();
    await user.tab();
    await user.keyboard('{Enter}');
    await user.tab();
    expect(screen.getByRole('button', { name: '黑色' })).toHaveFocus();

    await user.keyboard('{Enter}');

    expect(onPick).toHaveBeenCalledWith('#111827');
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it('returns focus to the toggle when Clear is chosen from the keyboard', async () => {
    const { user, onClear } = setup();
    const toggle = toggleButton();
    await user.tab();
    await user.keyboard('{Enter}');
    for (let i = 0; i <= TEXT_COLORS.length; i += 1) await user.tab();
    expect(screen.getByRole('button', { name: '清除' })).toHaveFocus();

    await user.keyboard('{Enter}');

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it('leaves focus alone when the pick callback moves it elsewhere', async () => {
    const { user, onPick } = setup({ before: <textarea aria-label="editor" /> });
    const editor = screen.getByRole('textbox', { name: 'editor' });
    onPick.mockImplementation(() => editor.focus());
    await user.tab();
    await user.tab();
    expect(toggleButton()).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.tab();
    expect(screen.getByRole('button', { name: '黑色' })).toHaveFocus();

    await user.keyboard('{Enter}');

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(editor).toHaveFocus();
  });

  it('closes when keyboard focus tabs out of the palette', async () => {
    const { user } = setup({ after: <button type="button">下一個</button> });
    await user.tab();
    await user.keyboard('{Enter}');
    for (let i = 0; i <= TEXT_COLORS.length; i += 1) await user.tab();
    expect(screen.getByRole('button', { name: '清除' })).toHaveFocus();

    await user.tab();

    expect(screen.getByRole('button', { name: '下一個' })).toHaveFocus();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(toggleButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('stays open while keyboard focus moves between the toggle and the swatches', async () => {
    const { user } = setup();
    await user.tab();
    await user.keyboard('{Enter}');
    await user.tab();
    expect(screen.getByRole('button', { name: '黑色' })).toHaveFocus();

    await user.tab({ shift: true });

    expect(toggleButton()).toHaveFocus();
    expect(screen.getByRole('group', { name: '字色色盤' })).toBeInTheDocument();
  });

  it('leaves focus where it was when Escape closes a mouse-opened popover', async () => {
    const { user } = setup({ before: <textarea aria-label="editor" /> });
    const editor = screen.getByRole('textbox', { name: 'editor' });
    await user.click(editor);
    await user.click(toggleButton());
    expect(editor).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(editor).toHaveFocus();
  });
});
