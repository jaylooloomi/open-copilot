import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_ENTRY_URL, APP_ORIGIN, isAppUrl, resolveAppPath } from './appProtocol';

const root = path.resolve('fixtures', 'web');
const inRoot = (...segments: string[]) => path.join(root, ...segments);

describe('resolveAppPath', () => {
  it('serves index.html for the root URL', () => {
    expect(resolveAppPath('app://bundle/', root)).toBe(inRoot('index.html'));
    expect(resolveAppPath('app://bundle', root)).toBe(inRoot('index.html'));
    expect(resolveAppPath(APP_ENTRY_URL, root)).toBe(inRoot('index.html'));
  });

  it('maps Vite asset paths into the root', () => {
    expect(resolveAppPath('app://bundle/assets/index-B1x2.js', root)).toBe(
      inRoot('assets', 'index-B1x2.js'),
    );
    expect(resolveAppPath('app://bundle/assets/toDocx-C3d4.js', root)).toBe(
      inRoot('assets', 'toDocx-C3d4.js'),
    );
  });

  it('ignores query strings and fragments', () => {
    expect(resolveAppPath('app://bundle/index.html?v=2#top', root)).toBe(inRoot('index.html'));
    expect(resolveAppPath('app://bundle/?from=test', root)).toBe(inRoot('index.html'));
    expect(resolveAppPath('app://bundle/assets/app.css?inline', root)).toBe(inRoot('assets', 'app.css'));
  });

  it('decodes percent-encoded paths', () => {
    expect(resolveAppPath('app://bundle/assets/%E4%B8%AD%E6%96%87%20%E5%AD%97%E5%9E%8B.woff2', root)).toBe(
      inRoot('assets', '中文 字型.woff2'),
    );
  });

  it('blocks path traversal, including encoded separators', () => {
    for (const url of [
      'app://bundle/..%2F..%2Fsecret.txt',
      'app://bundle/assets/..%2F..%2F..%2Fsecret.txt',
      'app://bundle/..%5C..%5Csecret.txt',
      'app://bundle/assets%2F..%2F..%2Fsecret.txt',
      'app://bundle/%2E%2E%2Fsecret.txt',
    ]) {
      expect(resolveAppPath(url, root), url).toBeNull();
    }
  });

  it('keeps dot segments that the URL parser normalizes inside the root', () => {
    expect(resolveAppPath('app://bundle/../../secret.txt', root)).toBe(inRoot('secret.txt'));
    expect(resolveAppPath('app://bundle/%2e%2e/%2e%2e/secret.txt', root)).toBe(inRoot('secret.txt'));
  });

  it('rejects backslashes, drive letters, NUL bytes and malformed encoding', () => {
    expect(resolveAppPath('app://bundle/assets%5Cindex.js', root)).toBeNull();
    expect(resolveAppPath('app://bundle/C:/Windows/win.ini', root)).toBeNull();
    expect(resolveAppPath('app://bundle/index.html%00.js', root)).toBeNull();
    expect(resolveAppPath('app://bundle/%E4%B8', root)).toBeNull();
  });

  it('rejects other hosts, other schemes and non-URLs', () => {
    expect(resolveAppPath('app://evil/index.html', root)).toBeNull();
    expect(resolveAppPath('https://bundle/index.html', root)).toBeNull();
    expect(resolveAppPath('file:///C:/Windows/win.ini', root)).toBeNull();
    expect(resolveAppPath('not a url', root)).toBeNull();
  });
});

describe('isAppUrl', () => {
  it('accepts only pages on app://bundle', () => {
    expect(APP_ORIGIN).toBe('app://bundle');
    expect(isAppUrl('app://bundle/index.html')).toBe(true);
    expect(isAppUrl('app://bundle/')).toBe(true);
    expect(isAppUrl('app://other/index.html')).toBe(false);
    expect(isAppUrl('https://example.com/')).toBe(false);
    expect(isAppUrl('')).toBe(false);
  });
});
