import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiPanelState } from '../ai/useAiAssistant';
import { AI_PANEL_TEXT, AiPanel, type AiPanelProps } from './AiPanel';

function setup(state: AiPanelState, props: Partial<AiPanelProps> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onRetry: vi.fn(),
    onInsertSummary: vi.fn(),
    onInsertTodos: vi.fn(),
    copyText: vi.fn(async (_text: string) => undefined),
  };
  render(<AiPanel state={state} {...handlers} {...props} />);
  return { ...handlers, user: userEvent.setup() };
}

const panel = (name: string) => screen.getByRole('complementary', { name });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AiPanel', () => {
  it('shows a loading status under the feature title and moves focus to the title', () => {
    setup({ requestId: 1, kind: 'summary', status: 'loading' });
    expect(panel('AI 摘要')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(AI_PANEL_TEXT.loading);
    expect(screen.getByRole('heading', { name: 'AI 摘要' })).toHaveFocus();
  });

  it('shows the summary one paragraph per line, inserts it and copies it', async () => {
    const summary = '第一點\n\n第二點';
    const { user, onInsertSummary, copyText } = setup({ requestId: 1, kind: 'summary', status: 'done', summary });

    const lines = Array.from(document.querySelectorAll('.oc-ai-summary p')).map((p) => p.textContent);
    expect(lines).toEqual(['第一點', '第二點']);

    await user.click(screen.getByRole('button', { name: AI_PANEL_TEXT.insertSummary }));
    expect(onInsertSummary).toHaveBeenCalledWith(summary);

    await user.click(screen.getByRole('button', { name: AI_PANEL_TEXT.copy }));
    expect(copyText).toHaveBeenCalledWith(summary);
    expect(await screen.findByText(AI_PANEL_TEXT.copied)).toBeInTheDocument();
  });

  it('says so when copying fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user } = setup(
      { requestId: 1, kind: 'summary', status: 'done', summary: '摘要' },
      { copyText: vi.fn(async () => Promise.reject(new Error('denied'))) },
    );
    await user.click(screen.getByRole('button', { name: AI_PANEL_TEXT.copy }));
    expect(await screen.findByText(AI_PANEL_TEXT.copyFailed)).toBeInTheDocument();
  });

  it('has nothing to insert or copy for a blank summary', () => {
    setup({ requestId: 1, kind: 'summary', status: 'done', summary: '  \n ' });
    expect(screen.getByText(AI_PANEL_TEXT.emptySummary)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: AI_PANEL_TEXT.insertSummary })).toBeDisabled();
    expect(screen.getByRole('button', { name: AI_PANEL_TEXT.copy })).toBeDisabled();
  });

  it('shows the todos as a checklist and inserts what is checked', async () => {
    const { user, onInsertTodos } = setup({
      requestId: 1,
      kind: 'todos',
      status: 'done',
      items: ['寄出報價單', ' ', '預約會議室'],
    });
    expect(panel('待辦事項')).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    for (const box of boxes) expect(box).not.toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: '預約會議室' }));
    await user.click(screen.getByRole('button', { name: AI_PANEL_TEXT.insertTodos }));

    expect(onInsertTodos).toHaveBeenCalledWith([
      { text: '寄出報價單', checked: false },
      { text: '預約會議室', checked: true },
    ]);
  });

  it('says there are no todos and offers nothing to insert', () => {
    setup({ requestId: 1, kind: 'todos', status: 'done', items: [] });
    expect(screen.getByText(AI_PANEL_TEXT.noTodos)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: AI_PANEL_TEXT.insertTodos })).not.toBeInTheDocument();
  });

  it('shows an error with a retry button', async () => {
    const { user, onRetry } = setup({ requestId: 1, kind: 'todos', status: 'error', message: 'AI 處理失敗，請稍後再試' });
    expect(screen.getByRole('alert')).toHaveTextContent('AI 處理失敗，請稍後再試');
    await user.click(screen.getByRole('button', { name: AI_PANEL_TEXT.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('closes from the close button and with Escape', async () => {
    const { user, onClose } = setup({ requestId: 1, kind: 'summary', status: 'loading' });
    await user.click(screen.getByRole('button', { name: AI_PANEL_TEXT.close }));
    screen.getByRole('heading', { name: 'AI 摘要' }).focus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('disables inserting with the reason as title', () => {
    setup(
      { requestId: 1, kind: 'summary', status: 'done', summary: '摘要' },
      { insertDisabledReason: '錄音中無法使用 AI 功能' },
    );
    const insert = screen.getByRole('button', { name: AI_PANEL_TEXT.insertSummary });
    expect(insert).toBeDisabled();
    expect(insert).toHaveAttribute('title', '錄音中無法使用 AI 功能');
    expect(screen.getByRole('button', { name: AI_PANEL_TEXT.copy })).toBeEnabled();
  });
});
