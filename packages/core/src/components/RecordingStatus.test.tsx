import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLevelStore } from '../recording/levelStore';
import { RecordingStatus } from './RecordingStatus';

const START = 1_000_000;

beforeEach(() => {
  vi.useFakeTimers({ now: START });
});

afterEach(() => {
  vi.useRealTimers();
});

const timer = () => screen.getByRole('timer', { name: '錄音時間' });
const meter = (container: HTMLElement) => container.querySelector('.oc-level-meter');

describe('RecordingStatus', () => {
  it('renders nothing when not recording and nothing is being transcribed', () => {
    const { container } = render(<RecordingStatus recording={false} startedAt={null} transcribing={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('counts mm:ss from startedAt while recording', () => {
    render(<RecordingStatus recording startedAt={START} transcribing={0} />);
    expect(timer()).toHaveTextContent('00:00');
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(timer()).toHaveTextContent('00:01');
    act(() => {
      vi.advanceTimersByTime(64_000);
    });
    expect(timer()).toHaveTextContent('01:05');
  });

  it('keeps one interval when the parent passes a new now function on each render', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { rerender } = render(
      <RecordingStatus recording startedAt={START} transcribing={0} now={() => Date.now()} />,
    );
    rerender(<RecordingStatus recording startedAt={START} transcribing={0} now={() => Date.now()} />);
    rerender(<RecordingStatus recording startedAt={START} transcribing={0} now={() => Date.now() + 2_000} />);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(timer()).toHaveTextContent('00:03');
    setIntervalSpy.mockRestore();
  });

  it('includes the time that already passed since startedAt', () => {
    render(<RecordingStatus recording startedAt={START - 5_000} transcribing={0} />);
    expect(timer()).toHaveTextContent('00:05');
  });

  it('shows five bars lit by the level store and hides them from assistive technology', () => {
    const levels = createLevelStore();
    const { container } = render(
      <RecordingStatus recording startedAt={START} levels={levels} transcribing={0} />,
    );
    const element = meter(container)!;
    expect(element).toHaveAttribute('aria-hidden', 'true');
    expect(element.children).toHaveLength(5);
    expect(element).toHaveAttribute('data-level', '0');

    act(() => levels.set(0.07));
    expect(element).toHaveAttribute('data-level', '3');
    expect(element.querySelectorAll('.oc-level-bar.is-on')).toHaveLength(3);

    act(() => levels.set(0.5));
    expect(element).toHaveAttribute('data-level', '5');
  });

  it('shows 轉寫中 N 段 only while N > 0', () => {
    const { rerender } = render(<RecordingStatus recording startedAt={START} transcribing={0} />);
    expect(screen.queryByText(/轉寫中/)).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    rerender(<RecordingStatus recording startedAt={START} transcribing={2} />);
    expect(screen.getByRole('status')).toHaveTextContent('轉寫中 2 段');
  });

  it('drops the timer and the meter once recording stops but keeps the count', () => {
    const { container, rerender } = render(
      <RecordingStatus recording startedAt={START} transcribing={1} />,
    );
    rerender(<RecordingStatus recording={false} startedAt={null} transcribing={1} />);
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(meter(container)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('轉寫中 1 段');
  });
});
