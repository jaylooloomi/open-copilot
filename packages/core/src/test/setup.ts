import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom has no layout engine. ProseMirror measures DOM ranges when it scrolls the
// selection into view (e.g. after editor.chain().focus()), so give ranges empty rects.
const emptyRect = (): DOMRect => DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
Range.prototype.getBoundingClientRect = emptyRect;
Range.prototype.getClientRects = () => {
  const rects: DOMRect[] = [];
  return Object.assign(rects, { item: () => null }) as unknown as DOMRectList;
};
