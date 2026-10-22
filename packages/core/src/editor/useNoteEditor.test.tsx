import type { JSONContent } from "@oc/shared";
import { renderHook, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { useLayoutEffect, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useNoteEditor } from "./useNoteEditor";

const doc = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

interface Props {
  content: JSONContent;
  revision: number;
}

function renderEditor() {
  return renderHook(
    ({ content, revision }: Props) =>
      useNoteEditor({ noteId: "a", revision, content, onChange: vi.fn() }),
    { initialProps: { content: doc("舊內容"), revision: 0 } },
  );
}

describe("useNoteEditor", () => {
  it("ignores new content for the same note and revision", () => {
    const { result, rerender } = renderEditor();
    rerender({ content: doc("新內容"), revision: 0 });
    expect(result.current.getText()).toBe("舊內容");
  });

  it("recreates the editor from the new content when the revision changes", async () => {
    const { result, rerender } = renderEditor();
    rerender({ content: doc("新內容"), revision: 1 });
    await waitFor(() => expect(result.current.getText()).toBe("新內容"));
  });

  it("drops edits from the previous revision's editor before it is replaced", async () => {
    const onChange = vi.fn();
    const stale: Editor[] = [];
    const { result, rerender } = renderHook(
      ({ revision }: { revision: number }) => {
        const editor = useNoteEditor({
          noteId: "a",
          revision,
          content: doc("舊內容"),
          onChange,
        });
        const previous = useRef(revision);
        // Layout effects run after the revision-1 render but before useEditor swaps the instance
        // in its passive effect: the window where the revision-0 editor is still live.
        useLayoutEffect(() => {
          if (previous.current !== revision) {
            stale.push(editor);
            editor.commands.insertContent("過期編輯");
          }
          previous.current = revision;
        });
        return editor;
      },
      { initialProps: { revision: 0 } },
    );
    rerender({ revision: 1 });
    await waitFor(() => expect(result.current).not.toBe(stale[0]));
    expect(stale).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});
