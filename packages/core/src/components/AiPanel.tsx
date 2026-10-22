import { Copy, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { summaryLines, type TodoItem } from '../ai/insertAi';
import type { AiKind, AiPanelState } from '../ai/useAiAssistant';

export const AI_PANEL_TITLES: Record<AiKind, string> = { summary: 'AI 摘要', todos: '待辦事項' };

export const AI_PANEL_TEXT = {
  loading: 'AI 處理中…',
  retry: '重試',
  insertSummary: '插入到筆記開頭',
  copy: '複製',
  copied: '已複製',
  copyFailed: '無法複製，請手動選取文字',
  emptySummary: 'AI 沒有產生摘要，請稍後再試。',
  insertTodos: '插入到筆記結尾',
  noTodos: '這篇筆記裡沒有找到待辦事項。',
  close: '關閉 AI 面板',
} as const;

const defaultCopyText = async (text: string) => {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard?.writeText) throw new Error('Clipboard API is not available');
  await clipboard.writeText(text);
};

export interface AiPanelProps {
  state: AiPanelState;
  onClose(): void;
  onRetry(): void;
  onInsertSummary(summary: string): void;
  onInsertTodos(items: TodoItem[]): void;
  /** Why inserting is not possible right now (e.g. while recording); shown as the buttons' title. */
  insertDisabledReason?: string;
  /** Hides the panel from focus and assistive technology, e.g. while the note drawer is open. */
  inert?: boolean;
  /** navigator.clipboard.writeText by default; injectable for tests. */
  copyText?: (text: string) => Promise<void>;
}

/** Side panel for AI 摘要 and 待辦事項. Key it on state.requestId so every request starts fresh. */
export function AiPanel({
  state,
  onClose,
  onRetry,
  onInsertSummary,
  onInsertTodos,
  insertDisabledReason,
  inert,
  copyText = defaultCopyText,
}: AiPanelProps) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <aside
      className="oc-ai-panel"
      aria-labelledby={titleId}
      inert={inert}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="oc-ai-panel-header">
        <h2 id={titleId} ref={headingRef} tabIndex={-1}>
          {AI_PANEL_TITLES[state.kind]}
        </h2>
        <button type="button" className="oc-icon-btn" aria-label={AI_PANEL_TEXT.close} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="oc-ai-panel-body">
        {state.status === 'loading' && (
          <p className="oc-ai-panel-status" role="status">
            {AI_PANEL_TEXT.loading}
          </p>
        )}
        {state.status === 'error' && (
          <>
            <p className="oc-ai-panel-error" role="alert">
              {state.message}
            </p>
            <div className="oc-ai-panel-actions">
              <button type="button" className="oc-action-btn" onClick={onRetry}>
                {AI_PANEL_TEXT.retry}
              </button>
            </div>
          </>
        )}
        {state.status === 'done' && state.kind === 'summary' && (
          <SummaryResult
            summary={state.summary}
            onInsert={onInsertSummary}
            insertDisabledReason={insertDisabledReason}
            copyText={copyText}
          />
        )}
        {state.status === 'done' && state.kind === 'todos' && (
          <TodoResult items={state.items} onInsert={onInsertTodos} insertDisabledReason={insertDisabledReason} />
        )}
      </div>
    </aside>
  );
}

function SummaryResult({
  summary,
  onInsert,
  insertDisabledReason,
  copyText,
}: {
  summary: string;
  onInsert(summary: string): void;
  insertDisabledReason?: string;
  copyText(text: string): Promise<void>;
}) {
  const [copyMessage, setCopyMessage] = useState('');
  const lines = summaryLines(summary);
  const empty = lines.length === 0;

  const copy = () => {
    // Clear first so the live region announces the result of every copy, not only the first one.
    setCopyMessage('');
    copyText(summary).then(
      () => setCopyMessage(AI_PANEL_TEXT.copied),
      (error: unknown) => {
        console.error('Failed to copy the summary', error);
        setCopyMessage(AI_PANEL_TEXT.copyFailed);
      },
    );
  };

  return (
    <>
      {empty ? (
        <p className="oc-ai-panel-status">{AI_PANEL_TEXT.emptySummary}</p>
      ) : (
        <div className="oc-ai-summary">
          {lines.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
      )}
      <div className="oc-ai-panel-actions">
        <button
          type="button"
          className="oc-primary-btn"
          disabled={empty || insertDisabledReason !== undefined}
          title={insertDisabledReason}
          onClick={() => onInsert(summary)}
        >
          {AI_PANEL_TEXT.insertSummary}
        </button>
        <button type="button" className="oc-action-btn" disabled={empty} onClick={copy}>
          <Copy size={14} aria-hidden="true" />
          <span>{AI_PANEL_TEXT.copy}</span>
        </button>
      </div>
      <p className="oc-ai-panel-note" aria-live="polite">
        {copyMessage}
      </p>
    </>
  );
}

function TodoResult({
  items,
  onInsert,
  insertDisabledReason,
}: {
  items: string[];
  onInsert(items: TodoItem[]): void;
  insertDisabledReason?: string;
}) {
  const texts = items.map((item) => item.trim()).filter((item) => item !== '');
  const [checked, setChecked] = useState<boolean[]>(() => texts.map(() => false));

  if (texts.length === 0) return <p className="oc-ai-panel-status">{AI_PANEL_TEXT.noTodos}</p>;

  return (
    <>
      <ul className="oc-ai-todos">
        {texts.map((text, index) => (
          <li key={index}>
            <label>
              <input
                type="checkbox"
                checked={checked[index] ?? false}
                onChange={(event) => {
                  const value = event.target.checked;
                  setChecked((previous) => previous.map((old, i) => (i === index ? value : old)));
                }}
              />
              <span>{text}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="oc-ai-panel-actions">
        <button
          type="button"
          className="oc-primary-btn"
          disabled={insertDisabledReason !== undefined}
          title={insertDisabledReason}
          onClick={() => onInsert(texts.map((text, index) => ({ text, checked: checked[index] ?? false })))}
        >
          {AI_PANEL_TEXT.insertTodos}
        </button>
      </div>
    </>
  );
}
