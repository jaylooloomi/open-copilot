import { EMPTY_DOC, type Note } from '@oc/shared';
import { describe, expect, it } from 'vitest';
import { collectGapIds } from './gapRefs';

const note = (id: string, content: Note['content']): Note => ({ id, title: '', content, createdAt: 1, updatedAt: 1 });
const gap = (gapId: string) => ({ type: 'transcriptGap', attrs: { gapId, seq: 1 } });

describe('collectGapIds', () => {
  it('finds every ⚠ marker in every note, nested blocks included', () => {
    const notes = [
      note('n1', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, gap('g1')] }] }),
      note('n2', {
        type: 'doc',
        content: [
          { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [gap('g2')] }] }] },
          { type: 'paragraph', content: [gap('g1')] },
        ],
      }),
      note('n3', EMPTY_DOC),
    ];
    expect([...collectGapIds(notes)].sort()).toEqual(['g1', 'g2']);
  });

  it('ignores markers without a gapId', () => {
    const notes = [note('n1', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'transcriptGap', attrs: { seq: 1 } }] }] })];
    expect(collectGapIds(notes).size).toBe(0);
  });
});
