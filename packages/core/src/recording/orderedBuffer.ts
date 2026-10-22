/** Re-orders results that arrive in any order so they can be used strictly by sequence number. */
export class OrderedBuffer<T> {
  private next: number;
  private readonly waiting = new Map<number, T>();

  constructor(firstSeq = 1) {
    this.next = firstSeq;
  }

  /** Stores `value` and returns every item that can now be released, in order. */
  put(seq: number, value: T): T[] {
    if (seq < this.next || this.waiting.has(seq)) return [];
    this.waiting.set(seq, value);
    const ready: T[] = [];
    while (this.waiting.has(this.next)) {
      ready.push(this.waiting.get(this.next) as T);
      this.waiting.delete(this.next);
      this.next += 1;
    }
    return ready;
  }
}
