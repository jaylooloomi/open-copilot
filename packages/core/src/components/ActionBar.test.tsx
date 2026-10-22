import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RecorderState } from '../recording/useRecorder';
import { ActionBar } from './ActionBar';

function setup(recordState: RecorderState = 'idle') {
  const onRecord = vi.fn();
  const onOpenSettings = vi.fn();
  const view = render(
    <ActionBar recordState={recordState} onRecord={onRecord} onOpenSettings={onOpenSettings} />,
  );
  return { ...view, onRecord, onOpenSettings, user: userEvent.setup() };
}

describe('ActionBar', () => {
  it.each([
    ['idle', '錄製', true],
    ['needsSetup', '請先設定', true],
    ['recording', '停止', true],
    ['stopping', '處理中', false],
  ] as const)('labels the record button for %s as %s', (state, label, enabled) => {
    setup(state);
    const button = screen.getByRole('button', { name: label });
    expect(button).toHaveClass('oc-record-btn');
    if (enabled) expect(button).toBeEnabled();
    else expect(button).toBeDisabled();
  });

  it.each([
    ['idle', '錄製', false],
    ['needsSetup', '請先設定', false],
    ['recording', '停止', true],
  ] as const)('with recordDisabled, the %s button (%s) enabled: %s', (state, label, enabled) => {
    render(<ActionBar recordState={state} recordDisabled onRecord={vi.fn()} onOpenSettings={vi.fn()} />);
    const button = screen.getByRole('button', { name: label });
    if (enabled) expect(button).toBeEnabled();
    else expect(button).toBeDisabled();
  });

  it('marks the record button while recording', () => {
    setup('recording');
    expect(screen.getByRole('button', { name: '停止' })).toHaveClass('is-recording');
  });

  it('calls onRecord when the record button is pressed', async () => {
    const { user, onRecord } = setup('idle');
    await user.click(screen.getByRole('button', { name: '錄製' }));
    expect(onRecord).toHaveBeenCalledTimes(1);
  });

  it('opens the settings from the gear button', async () => {
    const { user, onOpenSettings } = setup();
    await user.click(screen.getByRole('button', { name: '設定' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('shows the four locked AI buttons in order', () => {
    setup();
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
