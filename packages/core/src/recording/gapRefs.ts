import type { JSONContent, Note } from '@oc/shared';
import { TRANSCRIPT_GAP_TYPE } from '../export/common';

/**
 * The gapId of every ⚠ marker in these notes. A marker can be copied into another note, so the
 * audio of a gap is needed as long as any note still has it, whichever note recorded it.
 */
export function collectGapIds(notes: readonly Note[]): Set<string> {
  const ids = new Set<string>();
  const visit = (node: JSONContent) => {
    if (node.type === TRANSCRIPT_GAP_TYPE) {
      const gapId: unknown = node.attrs?.gapId;
      if (typeof gapId === 'string' && gapId !== '') ids.add(gapId);
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const note of notes) visit(note.content);
  return ids;
}
