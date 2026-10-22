import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { selectPlatform } from './selectPlatform';

// selectPlatform opens the default 'open-copilot' DB and Platform has no close(),
// so give every test a fresh fake IndexedDB instead of sharing notes across tests.
afterEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('selectPlatform (web)', () => {
  it('returns an IndexedDB-backed platform that can print', async () => {
    const platform = await selectPlatform();
    expect(platform.canPrint).toBe(true);
    expect(typeof platform.fileSaver.save).toBe('function');

    await platform.storage.put({
      id: 'n1',
      title: '測試',
      content: { type: 'doc' },
      createdAt: 1,
      updatedAt: 1,
    });
    expect(await platform.storage.list()).toEqual([
      expect.objectContaining({ id: 'n1', title: '測試' }),
    ]);
  });

  it('starts each test with an empty database', async () => {
    const platform = await selectPlatform();
    expect(await platform.storage.list()).toEqual([]);
  });
});
