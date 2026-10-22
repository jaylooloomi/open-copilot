import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserFileSaver } from './browserFileSaver';

describe('createBrowserFileSaver', () => {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:fake-url');
  const revokeObjectURL = vi.fn((_url: string) => undefined);
  let clicked: { href: string; download: string; attached: boolean }[];

  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no object URLs; install fakes.
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download, attached: this.isConnected });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  it('downloads the blob through a temporary <a download> link', async () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });
    await createBrowserFileSaver().save('筆記.txt', blob);

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([{ href: 'blob:fake-url', download: '筆記.txt', attached: true }]);
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('revokes the object URL after the download has started', async () => {
    await createBrowserFileSaver().save('a.md', new Blob(['# a']));
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});
