import type { Note } from '@oc/shared';
import type { Platform } from '../platform/types';
import { toFilename, type ExportFormat } from './filename';
import { printPdf } from './printPdf';
import { toMarkdown } from './toMarkdown';
import { toTxt } from './toTxt';

/** Builds the file for `format` and hands it to the platform's FileSaver; PDF goes through printing. */
export async function exportNote(note: Note, format: ExportFormat, platform: Platform): Promise<void> {
  switch (format) {
    case 'md':
      await platform.fileSaver.save(
        toFilename(note.title, 'md'),
        new Blob([toMarkdown(note)], { type: 'text/markdown;charset=utf-8' }),
      );
      return;
    case 'txt':
      await platform.fileSaver.save(
        toFilename(note.title, 'txt'),
        new Blob([toTxt(note)], { type: 'text/plain;charset=utf-8' }),
      );
      return;
    case 'docx': {
      // The docx library is ~400 kB; load it only when someone exports to Word.
      const { toDocx } = await import('./toDocx');
      await platform.fileSaver.save(toFilename(note.title, 'docx'), await toDocx(note));
      return;
    }
    case 'pdf':
      if (!platform.canPrint) throw new Error('PDF export is not available on this platform');
      printPdf(note);
      return;
    default: {
      const unreachable: never = format;
      throw new Error(`Unknown export format: ${String(unreachable)}`);
    }
  }
}
