import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLevelStore } from '../recording/levelStore';
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('shows the timer, level meter and transcribing count right after the record button while recording', () => {
    vi.useFakeTimers();
    const fixedNow = new Date('2026-10-22T10:00:00Z').getTime();
    vi.setSystemTime(fixedNow);
    const levels = createLevelStore();
    levels.set(0.5);
    render(
      <ActionBar
        recordState="recording"
        startedAt={fixedNow - 65_000}
        levels={levels}
        transcribing={1}
        onRecord={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    const status = screen.getByRole('button', { name: '停止' }).nextElementSibling;
    expect(status).toHaveClass('oc-rec-status');
    expect(screen.getByRole('timer', { name: '錄音時間' })).toHaveTextContent('01:05');
    expect(document.querySelector('.oc-level-meter')).toHaveAttribute('data-level', '5');
    expect(screen.getByText('轉寫中 1 段')).toBeInTheDocument();
  });

  it('times the recording with the clock it is given', () => {
    render(
      <ActionBar
        recordState="recording"
        startedAt={1_000}
        now={() => 126_000}
        onRecord={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    expect(screen.getByRole('timer', { name: '錄音時間' })).toHaveTextContent('02:05');
  });

  it('drops the timer and meter while stopping but keeps the transcribing count', () => {
    render(
      <ActionBar
        recordState="stopping"
        startedAt={null}
        transcribing={2}
        onRecord={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(document.querySelector('.oc-level-meter')).toBeNull();
    expect(screen.getByText('轉寫中 2 段')).toBeInTheDocument();
  });

  it('shows no recording status when idle', () => {
    setup('idle');
    expect(document.querySelector('.oc-rec-status')).toBeNull();
  });
});

describe('ActionBar AI actions', () => {
  it('unlocks AI 摘要 and 待辦事項 and keeps AI 助理 and AI 對話 locked', async () => {
    const summary = vi.fn();
    const todos = vi.fn();
    render(<ActionBar recordState="idle" onRecord={vi.fn()} onOpenSettings={vi.fn()} ai={{ summary, todos }} />);
    const user = userEvent.setup();

    for (const name of ['AI 摘要', '待辦事項']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute('aria-disabled');
      expect(button).toHaveClass('oc-ai-btn', 'is-available');
      expect(button).toHaveAttribute('title', name);
      expect(button.querySelector('svg')).not.toBeNull();
    }
    for (const name of ['AI 助理', 'AI 對話']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAttribute('title', '即將推出');
    }
    const order = Array.from(document.querySelectorAll('.oc-ai-btn')).map((b) => b.textContent);
    expect(order).toEqual(['AI 摘要', '待辦事項', 'AI 助理', 'AI 對話']);

    await user.click(screen.getByRole('button', { name: 'AI 摘要' }));
    await user.click(screen.getByRole('button', { name: '待辦事項' }));
    expect(summary).toHaveBeenCalledTimes(1);
    expect(todos).toHaveBeenCalledTimes(1);
  });

  it('disables both with the reason as their title and description and ignores clicks', async () => {
    const summary = vi.fn();
    const todos = vi.fn();
    render(
      <ActionBar
        recordState="recording"
        onRecord={vi.fn()}
        onOpenSettings={vi.fn()}
        ai={{ summary, todos, disabledReason: '錄音中無法使用 AI 功能' }}
      />,
    );
    const user = userEvent.setup();
    for (const name of ['AI 摘要', '待辦事項']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', '錄音中無法使用 AI 功能');
      expect(button).toHaveAccessibleDescription('錄音中無法使用 AI 功能');
      const describedBy = button.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy!)).toHaveTextContent('錄音中無法使用 AI 功能');
      await user.click(button);
    }
    expect(summary).not.toHaveBeenCalled();
    expect(todos).not.toHaveBeenCalled();
    for (const name of ['AI 助理', 'AI 對話']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', '即將推出');
    }
  });

  it('has no description while the AI buttons can be used', () => {
    render(<ActionBar recordState="idle" onRecord={vi.fn()} onOpenSettings={vi.fn()} ai={{ summary: vi.fn(), todos: vi.fn() }} />);
    for (const name of ['AI 摘要', '待辦事項']) {
      expect(screen.getByRole('button', { name })).not.toHaveAttribute('aria-describedby');
    }
  });

  it('treats an empty disabled reason as usable', () => {
    render(
      <ActionBar
        recordState="idle"
        onRecord={vi.fn()}
        onOpenSettings={vi.fn()}
        ai={{ summary: vi.fn(), todos: vi.fn(), disabledReason: '' }}
      />,
    );
    for (const name of ['AI 摘要', '待辦事項']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeEnabled();
      expect(button).toHaveAttribute('title', name);
    }
  });
});
