import type { Note } from '@oc/shared';
import { displayTitle } from '../notes/noteStore';
import { escapeHtml, toHtml } from './toHtml';

/** Marks the hidden print frame so a leftover one can be found and removed. */
export const PRINT_FRAME_ATTRIBUTE = 'data-oc-print';

const PRINT_CSS = `
@page { margin: 2cm; }
body {
  margin: 0;
  color: #111827;
  font-family: system-ui, -apple-system, 'Segoe UI', 'Noto Sans TC', 'PingFang TC',
    'Microsoft JhengHei', sans-serif;
  font-size: 12pt;
  line-height: 1.7;
}
h1 { font-size: 22pt; margin: 0 0 12pt; }
h2 { font-size: 18pt; margin: 16pt 0 8pt; }
h3 { font-size: 15pt; margin: 14pt 0 6pt; }
h4 { font-size: 13pt; margin: 12pt 0 6pt; }
p { margin: 0 0 6pt; }
ul, ol { margin: 0 0 6pt; padding-left: 1.5em; }
li > p { margin: 0; }
mark { padding: 0 1px; border-radius: 2px; }
/* Browsers skip background colours when printing unless told otherwise. */
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;

/** Puts the tab title back; set while a print started by printPdf has not finished. */
let restoreTitle: (() => void) | undefined;

/**
 * Prints the note from a hidden iframe so the browser's print dialog can save it as PDF.
 * Only call it when `platform.canPrint` is true (Android WebView has no window.print).
 */
export function printPdf(note: Note): void {
  // A print whose `afterprint` never fired: put the tab title back and drop its frame.
  restoreTitle?.();
  document.querySelectorAll(`iframe[${PRINT_FRAME_ATTRIBUTE}]`).forEach((frame) => frame.remove());

  const iframe = document.createElement('iframe');
  iframe.setAttribute(PRINT_FRAME_ATTRIBUTE, '');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  // Not display:none / visibility:hidden: some browsers then print an empty page.
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);

  const frameWindow = iframe.contentWindow;
  const frameDocument = iframe.contentDocument;
  if (!frameWindow || !frameDocument) {
    iframe.remove();
    throw new Error('Print frame is not available');
  }

  frameDocument.open();
  frameDocument.write(printDocument(note));
  frameDocument.close();

  // Chrome names the saved PDF after the tab (top-level document) title, not the iframe's <title>.
  const previousTitle = document.title;
  document.title = displayTitle(note);
  restoreTitle = () => {
    document.title = previousTitle;
    restoreTitle = undefined;
  };

  frameWindow.addEventListener(
    'afterprint',
    () => {
      restoreTitle?.();
      iframe.remove();
    },
    { once: true },
  );
  try {
    frameWindow.print();
  } catch (error) {
    restoreTitle?.();
    iframe.remove();
    throw error;
  }
}

function printDocument(note: Note): string {
  return [
    '<!doctype html>',
    '<html lang="zh-Hant-TW">',
    '<head>',
    '<meta charset="utf-8">',
    // Kept for browsers that name the PDF after the printed frame; Chrome uses the tab title.
    `<title>${escapeHtml(displayTitle(note))}</title>`,
    `<style>${PRINT_CSS}</style>`,
    '</head>',
    `<body>${toHtml(note)}</body>`,
    '</html>',
  ].join('');
}
