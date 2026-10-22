import type { JSONContent } from '@oc/shared';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useNoteEditor } from './useNoteEditor';

const doc = (text: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

interface Props {
  content: JSONContent;
  revision: number;
}

function renderEditor() {
  return renderHook(
    ({ content, revision }: Props) => useNoteEditor({ noteId: 'a', revision, content, onChange: vi.fn() }),
    { initialProps: { content: doc('舊內容'), revision: 0 } },
  );
}

describe('useNoteEditor', () => {
  it('ignores new content for the same note and revision', () => {
    const { result, rerender } = renderEditor();
    rerender({ content: doc('新內容'), revision: 0 });
    expect(result.current.getText()).toBe('舊內容');
  });

  it('recreates the editor from the new content when the revision changes', async () => {
    const { result, rerender } = renderEditor();
    rerender({ content: doc('新內容'), revision: 1 });
    await waitFor(() => expect(result.current.getText()).toBe('新內容'));
  });
});
