import type { Note } from '@oc/shared';
import { Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { copyNote } from '../export/copyNote';
import { exportNote } from '../export/exportNote';
import type { ExportFormat } from '../export/filename';
import { usePlatform } from '../platform/PlatformContext';
import { ExportMenu } from './ExportMenu';

/** How long a status message stays visible. */
export const STATUS_CLEAR_MS = 3000;

export const ACTION_MESSAGES = {
  copied: '已複製全文',
  copyFailed: '複製失敗，請再試一次',
  exported: { md: '已匯出 Markdown', docx: '已匯出 Word', txt: '已匯出純文字' },
  exportFailed: '匯出失敗，請再試一次',
} as const;

/** 複製 and 匯出 on the right of the toolbar, with an inline status message. */
export function NoteActions({ note }: { note: Note }) {
  const platform = usePlatform();
  const [status, setStatus] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const show = (message: string) => {
    clearTimeout(timer.current);
    setStatus(message);
    if (message) timer.current = setTimeout(() => setStatus(''), STATUS_CLEAR_MS);
  };

  const copy = async () => {
    try {
      await copyNote(note);
      show(ACTION_MESSAGES.copied);
    } catch {
      show(ACTION_MESSAGES.copyFailed);
    }
  };

  const runExport = async (format: ExportFormat) => {
    try {
      await exportNote(note, format, platform);
      // PDF ends in the browser's print dialog, which is its own feedback.
      show(format === 'pdf' ? '' : ACTION_MESSAGES.exported[format]);
    } catch (error) {
      // A FileSaver throws AbortError when the user cancels its dialog: not a failure.
      show(isAbortError(error) ? '' : ACTION_MESSAGES.exportFailed);
    }
  };

  return (
    <div className="oc-note-actions">
      <span className="oc-action-status" role="status">
        {status}
      </span>
      <button type="button" className="oc-action-btn" onClick={() => void copy()}>
        <Copy size={16} aria-hidden="true" />
        <span>複製</span>
      </button>
      <ExportMenu canPrint={platform.canPrint} onSelect={(format) => void runExport(format)} />
    </div>
  );
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}
