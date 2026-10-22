import type { JSONContent, Note } from '@oc/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRINT_FRAME_ATTRIBUTE, printPdf } from './printPdf';

const note = (title: string, ...content: JSONContent[]): Note => ({
  id: 'n1',
  title,
  content: { type: 'doc', content },
  createdAt: 1,
  updatedAt: 1,
});
const p = (value: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });

const frames = () => Array.from(document.querySelectorAll<HTMLIFrameElement>(`iframe[${PRINT_FRAME_ATTRIBUTE}]`));

/**
 * jsdom does not implement window.print (it only logs "Not implemented"). Swap in a spy on every
 * iframe as soon as it is attached, and record what the frame shows when print() is called, plus
 * the tab title at that moment (Chrome names the saved PDF after it).
 */
function stubFramePrint() {
  const printed: { title: string; tabTitle: string; body: string; css: string }[] = [];
  const print = vi.fn();
  const append = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
    const result = append(node);
    if (node instanceof HTMLIFrameElement) {
      const frameWindow = node.contentWindow!;
      frameWindow.print = () => {
        const doc = node.contentDocument!;
        printed.push({
          title: doc.title,
          tabTitle: document.title,
          body: doc.body.innerHTML,
          css: doc.querySelector('style')?.textContent ?? '',
        });
        print();
      };
    }
    return result;
  });
  return { print, printed };
}

const afterPrint = (frame: HTMLIFrameElement) => frame.contentWindow!.dispatchEvent(new Event('afterprint'));

beforeEach(() => {
  document.title = 'open-copilot';
});

afterEach(() => {
  vi.restoreAllMocks();
  // Finish any print still open so the module's pending title restore does not leak into the next test.
  frames().forEach((frame) => {
    afterPrint(frame);
    frame.remove();
  });
});

describe('printPdf', () => {
  it('prints the note from a hidden iframe, with the tab titled after the note', () => {
    const { print, printed } = stubFramePrint();
    printPdf(note('週會 <紀錄>', p('第一點')));

    expect(print).toHaveBeenCalledTimes(1);
    expect(printed[0].title).toBe('週會 <紀錄>');
    expect(printed[0].tabTitle).toBe('週會 <紀錄>');
    expect(printed[0].body).toBe('<h1>週會 &lt;紀錄&gt;</h1><p>第一點</p>');
    expect(printed[0].css).toContain('print-color-adjust: exact');

    const [frame] = frames();
    expect(frame).toHaveAttribute('aria-hidden', 'true');
    expect(frame.style.width).toBe('0px');
    expect(frame.style.height).toBe('0px');
  });

  it('uses 未命名筆記 as the title for an untitled note', () => {
    const { printed } = stubFramePrint();
    printPdf(note('', p('內文')));
    expect(printed[0].title).toBe('未命名筆記');
    expect(printed[0].tabTitle).toBe('未命名筆記');
    expect(printed[0].body).toBe('<p>內文</p>');
  });

  it('removes the iframe and restores the tab title after printing', () => {
    stubFramePrint();
    printPdf(note('A', p('a')));
    expect(document.title).toBe('A');

    afterPrint(frames()[0]);

    expect(frames()).toHaveLength(0);
    expect(document.title).toBe('open-copilot');
  });

  it('cleans up a print whose afterprint never fired before printing again', () => {
    const { print, printed } = stubFramePrint();
    printPdf(note('A', p('a')));
    printPdf(note('B', p('b')));

    expect(print).toHaveBeenCalledTimes(2);
    expect(printed[1].tabTitle).toBe('B');
    expect(frames()).toHaveLength(1);

    afterPrint(frames()[0]);
    expect(document.title).toBe('open-copilot');
  });

  it('restores the tab title and removes the iframe when print() throws', () => {
    const append = document.body.appendChild.bind(document.body);
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      const result = append(node);
      if (node instanceof HTMLIFrameElement) {
        node.contentWindow!.print = () => {
          throw new Error('print blocked');
        };
      }
      return result;
    });

    expect(() => printPdf(note('A', p('a')))).toThrow('print blocked');
    expect(frames()).toHaveLength(0);
    expect(document.title).toBe('open-copilot');
  });
});
