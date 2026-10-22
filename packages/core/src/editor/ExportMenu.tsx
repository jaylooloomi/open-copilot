import { ChevronDown, Download } from 'lucide-react';
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import type { ExportFormat } from '../export/filename';

export const EXPORT_OPTIONS: readonly { format: ExportFormat; label: string }[] = [
  { format: 'md', label: 'Markdown' },
  { format: 'docx', label: 'Word' },
  { format: 'txt', label: '純文字' },
  { format: 'pdf', label: 'PDF' },
];

export interface ExportMenuProps {
  /** false hides the PDF item (Platform.canPrint). */
  canPrint: boolean;
  onSelect(format: ExportFormat): void;
}

/** 匯出 button with a dropdown menu of formats. */
export function ExportMenu({ canPrint, onSelect }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const options = EXPORT_OPTIONS.filter((option) => canPrint || option.format !== 'pdf');

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const closeAndFocusButton = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndFocusButton();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  // Focus leaving the widget without a Tab or document mousedown (into the editor
  // iframe, another window) closes the menu. relatedTarget is null in those cases.
  const onMenuBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
  };

  return (
    <div className="oc-export" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="oc-action-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Download size={16} aria-hidden="true" />
        <span>匯出</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          className="oc-export-menu"
          role="menu"
          aria-label="匯出格式"
          onKeyDown={onMenuKeyDown}
          onBlur={onMenuBlur}
          // Keep focus on the menu while an item is pressed, so browsers that do not
          // focus buttons on click (Safari) do not blur, and close, before the click.
          onMouseDown={(event) => event.preventDefault()}
        >
          {options.map((option) => (
            <button
              key={option.format}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="oc-export-item"
              onClick={() => {
                closeAndFocusButton();
                onSelect(option.format);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
