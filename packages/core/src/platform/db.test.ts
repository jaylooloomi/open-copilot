import { describe, expect, it } from 'vitest';
import { openAppDb } from './db';

describe('openAppDb', () => {
  it('creates the notes and pendingSegments stores at version 1', async () => {
    const db = await openAppDb(`test-${crypto.randomUUID()}`);
    expect(db.version).toBe(1);
    expect([...db.objectStoreNames].sort()).toEqual(['notes', 'pendingSegments']);
    expect(db.transaction('notes').store.keyPath).toBe('id');
    expect(db.transaction('pendingSegments').store.keyPath).toBe('gapId');
    db.close();
  });

  it('reopens an existing database without losing data', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const first = await openAppDb(name);
    await first.put('notes', {
      id: 'n1',
      title: 'kept',
      content: { type: 'doc' },
      createdAt: 1,
      updatedAt: 1,
    });
    first.close();

    const second = await openAppDb(name);
    expect((await second.get('notes', 'n1'))?.title).toBe('kept');
    second.close();
  });
});
