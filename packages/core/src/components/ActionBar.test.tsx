import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActionBar } from './ActionBar';

describe('ActionBar', () => {
  it('shows a disabled 錄製 button marked 即將推出', () => {
    render(<ActionBar />);
    const record = screen.getByRole('button', { name: '錄製' });
    expect(record).toBeDisabled();
    expect(record).toHaveAttribute('title', '即將推出');
  });

  it('shows the four locked AI buttons in order', () => {
    render(<ActionBar />);
    const labels = ['AI 摘要', '待辦事項', 'AI 助理', 'AI 對話'];
    const buttons = labels.map((name) => screen.getByRole('button', { name }));
    for (const button of buttons) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button.querySelector('svg')).not.toBeNull();
    }
    const aiButtons = Array.from(document.querySelectorAll('.oc-ai-btn')).map((b) => b.textContent);
    expect(aiButtons).toEqual(labels);
  });
});
