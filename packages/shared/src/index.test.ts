import { describe, expect, it } from 'vitest';
import {
  EMPTY_DOC,
  MAX_AUDIO_BYTES,
  RATE_LIMIT_PER_MINUTE,
  type ApiErrorBody,
  type Note,
  type TranscribeResponse,
} from './index';

describe('@oc/shared', () => {
  it('EMPTY_DOC is a Tiptap doc with one empty paragraph', () => {
    expect(EMPTY_DOC).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('exposes the API limits used by the backend and the recorder', () => {
    expect(MAX_AUDIO_BYTES).toBe(5 * 1024 * 1024);
    expect(RATE_LIMIT_PER_MINUTE).toBe(60);
  });

  it('types describe notes and API payloads', () => {
    const note: Note = { id: 'n1', title: '', content: EMPTY_DOC, createdAt: 1, updatedAt: 2 };
    const res: TranscribeResponse = { seq: 1, text: '你好' };
    const err: ApiErrorBody = { error: 'rate_limited' };
    expect([note.id, res.seq, err.error]).toEqual(['n1', 1, 'rate_limited']);
  });
});
