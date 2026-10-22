import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TitleInput } from './TitleInput';

function Controlled({ onEnter }: { onEnter?: () => void }) {
  const [value, setValue] = useState('');
  return <TitleInput value={value} onChange={setValue} onEnter={onEnter} />;
}

describe('TitleInput', () => {
  it('shows the zh-TW placeholder and the current value', () => {
    render(<TitleInput value="週會" onChange={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: '標題' });
    expect(input).toHaveAttribute('placeholder', '請輸入標題..');
    expect(input).toHaveValue('週會');
  });

  it('reports every change', async () => {
    const onChange = vi.fn();
    render(<TitleInput value="" onChange={onChange} />);
    await userEvent.setup().type(screen.getByRole('textbox', { name: '標題' }), 'A');
    expect(onChange).toHaveBeenCalledWith('A');
  });

  it('works as a controlled input', async () => {
    render(<Controlled />);
    const input = screen.getByRole('textbox', { name: '標題' });
    await userEvent.setup().type(input, '產品會議');
    expect(input).toHaveValue('產品會議');
  });

  it('calls onEnter on Enter', async () => {
    const onEnter = vi.fn();
    render(<Controlled onEnter={onEnter} />);
    await userEvent.setup().type(screen.getByRole('textbox', { name: '標題' }), '{Enter}');
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('ignores Enter while an IME composition is active', () => {
    const onEnter = vi.fn();
    render(<Controlled onEnter={onEnter} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: '標題' }), {
      key: 'Enter',
      isComposing: true,
    });
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('ignores the IME-confirming Enter reported with keyCode 229 (Safari)', () => {
    const onEnter = vi.fn();
    render(<Controlled onEnter={onEnter} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: '標題' }), {
      key: 'Enter',
      keyCode: 229,
    });
    expect(onEnter).not.toHaveBeenCalled();
  });
});
