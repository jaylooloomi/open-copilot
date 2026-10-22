import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { openAppDb } from '../platform/db';
import { createPendingQueue, type PendingSegment } from './pendingQueue';

/**
 * fake-indexeddb clones values with Node's structuredClone, which turns jsdom's Blob into a plain
 * object. Node's own Blob survives the clone, so it stands in for the browser Blob here.
 */
const segment = (gapId: string, seq = 1): PendingSegment => ({
  gapId,
  noteId: 'n1',
  seq,
  blob: new NodeBlob(['audio-bytes'], { type: 'audio/webm' }) as unknown as Blob,
  mimeType: 'audio/webm',
  prompt: '前一段',
});

const newDb = () => openAppDb(`test-${crypto.randomUUID()}`);

describe('createPendingQueue', () => {
  it('stores a failed segment, audio included, under its gapId', async () => {
    const queue = createPendingQueue(await newDb());
    await queue.add(segment('g1', 3));

    const stored = await queue.get('g1');
    expect(stored).toMatchObject({ gapId: 'g1', noteId: 'n1', seq: 3, mimeType: 'audio/webm', prompt: '前一段' });
    const blob = stored?.blob as unknown as NodeBlob;
    expect(blob.type).toBe('audio/webm');
    expect(await blob.text()).toBe('audio-bytes');
  });

  it('returns undefined for an unknown gap and removes entries', async () => {
    const queue = createPendingQueue(await newDb());
    await queue.add(segment('g1'));
    await queue.add(segment('g2', 2));
    expect(await queue.get('nope')).toBeUndefined();

    await queue.remove('g1');

    expect(await queue.get('g1')).toBeUndefined();
    expect((await queue.get('g2'))?.seq).toBe(2);
  });

  it('add() replaces an earlier entry with the same gapId', async () => {
    const queue = createPendingQueue(await newDb());
    await queue.add(segment('g1', 1));
    await queue.add({ ...segment('g1', 5), prompt: '新的' });

    expect(await queue.get('g1')).toMatchObject({ gapId: 'g1', seq: 5, prompt: '新的' });
  });

  it('also accepts the promise returned by openAppDb()', async () => {
    const queue = createPendingQueue(newDb());
    await queue.add(segment('g1'));
    expect((await queue.get('g1'))?.gapId).toBe('g1');
  });

  it('removeByNote drops every segment of a deleted note and keeps the others', async () => {
    const queue = createPendingQueue(await newDb());
    await queue.add(segment('g1', 1));
    await queue.add(segment('g2', 2));
    await queue.add({ ...segment('g3', 1), noteId: 'n2' });

    await queue.removeByNote('n1');

    expect(await queue.get('g1')).toBeUndefined();
    expect(await queue.get('g2')).toBeUndefined();
    expect((await queue.get('g3'))?.noteId).toBe('n2');
    await expect(queue.removeByNote('no-such-note')).resolves.toBeUndefined();
    expect(await queue.get('g3')).toBeDefined();
  });
});

describe('createPendingQueue: keeping audio that a note still refers to', () => {
  it('removeByNote keeps the segments listed in `keep`, e.g. a marker pasted into another note', async () => {
    const queue = createPendingQueue(await newDb());
    await queue.add(segment('g1', 1));
    await queue.add(segment('g2', 2));

    await queue.removeByNote('n1', new Set(['g2']));

    expect(await queue.get('g1')).toBeUndefined();
    expect(await queue.get('g2')).toBeDefined();
  });

  it('removeUnreferenced drops every segment whose gapId is not in the set', async () => {
    const queue = createPendingQueue(await newDb());
    await queue.add(segment('g1', 1));
    await queue.add({ ...segment('g2', 1), noteId: 'n2' });
    await queue.add(segment('g3', 3));

    await queue.removeUnreferenced(new Set(['g3', 'not-stored']));

    expect(await queue.get('g1')).toBeUndefined();
    expect(await queue.get('g2')).toBeUndefined();
    expect(await queue.get('g3')).toBeDefined();
  });
});
