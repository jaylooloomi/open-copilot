import { describe, expect, it } from 'vitest';
import { isAbortError } from './isAbortError';

describe('isAbortError', () => {
  it('recognises a cancelled dialog by the AbortError name', () => {
    expect(isAbortError(new DOMException('cancelled', 'AbortError'))).toBe(true);
    expect(isAbortError(Object.assign(new Error('cancelled'), { name: 'AbortError' }))).toBe(true);
  });

  it('does not treat other failures as a cancel', () => {
    expect(isAbortError(new Error('denied'))).toBe(false);
    expect(isAbortError(new DOMException('denied', 'NotAllowedError'))).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});
