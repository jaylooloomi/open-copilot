import { describe, expect, it, onTestFinished } from 'vitest';

describe('test setup', () => {
  it('provides jest-dom matchers', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    // RTL cleanup() only removes containers made by render(), so remove this one ourselves.
    onTestFinished(() => el.remove());
    expect(el).toBeInTheDocument();
  });

  it('provides a fake indexedDB', () => {
    expect(typeof indexedDB.open).toBe('function');
  });

  it('gives DOM ranges empty layout rects for ProseMirror', () => {
    const range = document.createRange();
    expect(range.getClientRects()).toHaveLength(0);
    expect(range.getBoundingClientRect().width).toBe(0);
  });
});
