import { AI_MAX_TEXT_CHARS } from '@oc/shared';
import { describe, expect, it, vi } from 'vitest';
import { countChars, parseAiRequest } from './request';

describe('parseAiRequest', () => {
  it('accepts a title and a non-blank text and returns them unchanged', () => {
    expect(parseAiRequest({ title: ' 週會 ', text: '  下週三前寄出報價單\n' })).toEqual({
      title: ' 週會 ',
      text: '  下週三前寄出報價單\n',
    });
  });

  it('accepts an empty title', () => {
    expect(parseAiRequest({ title: '', text: '內容' })).toEqual({ title: '', text: '內容' });
  });

  it('drops unknown fields', () => {
    expect(parseAiRequest({ title: 't', text: '內容', extra: 1 })).toEqual({
      title: 't',
      text: '內容',
    });
  });

  it.each([
    ['null', null],
    ['a string', 'text'],
    ['an array', [{ title: 't', text: '內容' }]],
    ['a missing title', { text: '內容' }],
    ['a missing text', { title: 't' }],
    ['a numeric title', { title: 1, text: '內容' }],
    ['a numeric text', { title: 't', text: 42 }],
    ['an empty text', { title: 't', text: '' }],
    ['a whitespace-only text', { title: 't', text: ' \n\t　' }],
  ] as const)('returns bad_request for %s', (_label, raw) => {
    expect(parseAiRequest(raw)).toBe('bad_request');
  });

  it('accepts exactly AI_MAX_TEXT_CHARS characters', () => {
    const text = '字'.repeat(AI_MAX_TEXT_CHARS);
    expect(parseAiRequest({ title: '', text })).toEqual({ title: '', text });
  });

  it('returns payload_too_large one character over AI_MAX_TEXT_CHARS', () => {
    expect(parseAiRequest({ title: '', text: '字'.repeat(AI_MAX_TEXT_CHARS + 1) })).toBe(
      'payload_too_large',
    );
  });

  it('counts an emoji as one character, not two UTF-16 units', () => {
    const text = '😀'.repeat(AI_MAX_TEXT_CHARS);
    expect(parseAiRequest({ title: '', text })).toEqual({ title: '', text });
  });

  it('returns payload_too_large for a text far beyond the limit without counting it', () => {
    const text = 'a'.repeat(AI_MAX_TEXT_CHARS * 2 + 1);
    const from = vi.spyOn(Array, 'from');
    try {
      expect(parseAiRequest({ title: '', text })).toBe('payload_too_large');
      expect(from).not.toHaveBeenCalled();
    } finally {
      from.mockRestore();
    }
  });
});

describe('countChars', () => {
  it('counts Unicode code points', () => {
    expect(countChars('')).toBe(0);
    expect(countChars('abc')).toBe(3);
    expect(countChars('繁體')).toBe(2);
    expect(countChars('😀😀')).toBe(2);
  });
});
