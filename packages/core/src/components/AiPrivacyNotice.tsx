import { useEffect, useId, useRef, type KeyboardEvent } from 'react';

export const AI_PRIVACY_TEXT = {
  title: 'AI 功能說明',
  body: '使用 AI 摘要或待辦事項時，筆記內容會送到 Groq 處理。',
  hint: '按「我知道了」後，這則說明就不會再出現。',
  accept: '我知道了',
  cancel: '取消',
} as const;

export interface AiPrivacyNoticeProps {
  /** 我知道了: remember the notice and send the request. */
  onAccept(): void;
  /** 取消, Escape or a click outside: close without sending. */
  onCancel(): void;
}

/** Shown once, before the first AI request: the note goes to Groq. Render it only while it is open. */
export function AiPrivacyNotice({ onAccept, onCancel }: AiPrivacyNoticeProps) {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    acceptRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const buttons = Array.from(dialogRef.current.querySelectorAll<HTMLButtonElement>('button'));
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (!first || !last) return;
    if (document.activeElement === dialogRef.current) {
      // Focus sits on the dialog itself after a click on its text: step to the first or last button.
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="oc-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="oc-dialog oc-ai-privacy"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        // -1 keeps focus in the dialog when its text is clicked, so Escape and the Tab trap still work.
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="oc-dialog-title">
          {AI_PRIVACY_TEXT.title}
        </h2>
        <p id={bodyId} className="oc-ai-privacy-body">
          {AI_PRIVACY_TEXT.body}
        </p>
        <p className="oc-dialog-hint">{AI_PRIVACY_TEXT.hint}</p>
        <div className="oc-dialog-actions">
          <button type="button" className="oc-action-btn" onClick={onCancel}>
            {AI_PRIVACY_TEXT.cancel}
          </button>
          <button ref={acceptRef} type="button" className="oc-primary-btn" onClick={onAccept}>
            {AI_PRIVACY_TEXT.accept}
          </button>
        </div>
      </div>
    </div>
  );
}
