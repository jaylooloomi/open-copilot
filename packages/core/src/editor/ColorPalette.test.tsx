import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ColorPalette } from './ColorPalette';
import { TEXT_COLORS } from './palettes';

function setup(current?: string) {
  const onPick = vi.fn();
  const onClear = vi.fn();
  render(
    <div>
      <ColorPalette
        label="字色"
        icon={<span>A</span>}
        colors={TEXT_COLORS}
        current={current}
        onPick={onPick}
        onClear={onClear}
      />
      <p>outside</p>
    </div>,
  );
  return { onPick, onClear, user: userEvent.setup() };
}

describe('ColorPalette', () => {
  it('opens an 8-colour palette with a clear button', async () => {
    const { user } = setup();
    const toggle = screen.getByRole('button', { name: '字色' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('group', { name: '字色色盤' });
    expect(within(group).getAllByRole('button')).toHaveLength(9);
    expect(within(group).getByRole('button', { name: '清除' })).toBeInTheDocument();
  });

  it('picks a colour and closes', async () => {
    const { user, onPick } = setup();
    await user.click(screen.getByRole('button', { name: '字色' }));
    await user.click(screen.getByRole('button', { name: '紅色' }));

    expect(onPick).toHaveBeenCalledWith('#dc2626');
    expect(screen.queryByRole('group', { name: '字色色盤' })).not.toBeInTheDocument();
  });

  it('clears and closes', async () => {
    const { user, onClear } = setup();
    await user.click(screen.getByRole('button', { name: '字色' }));
    await user.click(screen.getByRole('button', { name: '清除' }));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group', { name: '字色色盤' })).not.toBeInTheDocument();
  });

  it('marks the current colour as pressed', async () => {
    const { user } = setup('#2563eb');
    await user.click(screen.getByRole('button', { name: '字色' }));
    expect(screen.getByRole('button', { name: '藍色' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '紅色' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('closes on Escape and on outside click', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: '字色' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '字色' }));
    await user.click(screen.getByText('outside'));
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('returns focus to the toggle when Escape closes the popover from a swatch', async () => {
    const { user } = setup();
    const toggle = screen.getByRole('button', { name: '字色' });
    await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.tab();
    expect(screen.getByRole('button', { name: '黑色' })).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it('leaves focus where it was when Escape closes a mouse-opened popover', async () => {
    const onPick = vi.fn();
    const onClear = vi.fn();
    render(
      <div>
        <textarea aria-label="editor" />
        <ColorPalette
          label="字色"
          icon={<span>A</span>}
          colors={TEXT_COLORS}
          current={undefined}
          onPick={onPick}
          onClear={onClear}
        />
      </div>,
    );
    const user = userEvent.setup();
    const editor = screen.getByRole('textbox', { name: 'editor' });
    await user.click(editor);
    await user.click(screen.getByRole('button', { name: '字色' }));
    expect(editor).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(editor).toHaveFocus();
  });
});
