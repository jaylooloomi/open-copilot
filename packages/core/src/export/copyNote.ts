import type { Note } from '@oc/shared';
import { toHtml } from './toHtml';
import { toTxt } from './toTxt';

/**
 * Copies the whole note: rich HTML plus plain text when the browser allows it,
 * otherwise plain text only. Rejects when the clipboard cannot be written at all.
 */
export async function copyNote(note: Note): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard) throw new Error('Clipboard API is not available');
  const text = toTxt(note);

  if (typeof clipboard.write === 'function' && typeof ClipboardItem === 'function') {
    try {
      await clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([toHtml(note)], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return;
    } catch {
      // Rich copy can be refused (permissions, unsupported types); fall back to plain text.
    }
  }
  await clipboard.writeText(text);
}
