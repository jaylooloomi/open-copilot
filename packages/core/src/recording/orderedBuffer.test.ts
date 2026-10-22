import { describe, expect, it } from 'vitest';
import { OrderedBuffer } from './orderedBuffer';

describe('OrderedBuffer', () => {
  it('releases items that arrive in order straight away', () => {
    const buffer = new OrderedBuffer<string>();
    expect(buffer.put(1, 'a')).toEqual(['a']);
    expect(buffer.put(2, 'b')).toEqual(['b']);
  });

  it('holds later items until the gap before them is filled', () => {
    const buffer = new OrderedBuffer<string>();
    expect(buffer.put(3, 'c')).toEqual([]);
    expect(buffer.put(2, 'b')).toEqual([]);
    expect(buffer.put(1, 'a')).toEqual(['a', 'b', 'c']);
    expect(buffer.put(4, 'd')).toEqual(['d']);
  });

  it('ignores duplicates and items that were already released', () => {
    const buffer = new OrderedBuffer<string>();
    expect(buffer.put(2, 'b')).toEqual([]);
    expect(buffer.put(2, 'B')).toEqual([]);
    expect(buffer.put(1, 'a')).toEqual(['a', 'b']);
    expect(buffer.put(1, 'again')).toEqual([]);
  });

  it('can start from another sequence number', () => {
    const buffer = new OrderedBuffer<number>(5);
    expect(buffer.put(6, 60)).toEqual([]);
    expect(buffer.put(5, 50)).toEqual([50, 60]);
  });
});
