import type { JSONContent, Note } from '@oc/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/apiClient';
import {
  AI_DISABLED_REASONS,
  AI_MESSAGES,
  aiDisabledReason,
  aiErrorMessage,
  aiNoteText,
} from './aiMessages';

const note = (title: string, ...content: JSONContent[]): Note => ({
  id: 'n1',
  title,
  content: { type: 'doc', content },
  createdAt: 1,
  updatedAt: 1,
});
const p = (text?: string): JSONContent =>
  text === undefined ? { type: 'paragraph' } : { type: 'paragraph', content: [{ type: 'text', text }] };

describe('aiNoteText', () => {
  it('is the note body as plain text, without the title', () => {
    const text = aiNoteText(
      note(
        '週會',
        p('第一點'),
        { type: 'bulletList', content: [{ type: 'listItem', content: [p('寄出報價單')] }] },
        p(),
      ),
    );
    expect(text).toBe('第一點\n- 寄出報價單');
  });

  it('is empty for a note with only empty paragraphs', () => {
    expect(aiNoteText(note('週會', p(), p()))).toBe('');
  });
});

describe('aiDisabledReason', () => {
  const ready = { recording: false, configured: true, text: '內容' };

  it('is undefined when the AI buttons can be used', () => {
    expect(aiDisabledReason(ready)).toBeUndefined();
  });

  it('explains recording first, then a missing backend, then an empty note', () => {
    expect(aiDisabledReason({ recording: true, configured: false, text: '' })).toBe(AI_DISABLED_REASONS.recording);
    expect(aiDisabledReason({ ...ready, configured: false, text: '' })).toBe(AI_DISABLED_REASONS.notConfigured);
    expect(aiDisabledReason({ ...ready, text: ' \n ' })).toBe(AI_DISABLED_REASONS.empty);
  });

  it('treats a body of only untranscribed gaps as empty', () => {
    expect(aiDisabledReason({ ...ready, text: '[未轉寫片段]\n[未轉寫片段]' })).toBe(AI_DISABLED_REASONS.empty);
    expect(aiDisabledReason({ ...ready, text: '[未轉寫片段]\n報價單' })).toBeUndefined();
  });

  it('treats a body of only empty list and task items as empty', () => {
    const emptyItem = (): JSONContent => ({ type: 'listItem', content: [p()] });
    const text = aiNoteText(
      note(
        '週會',
        { type: 'bulletList', content: [emptyItem()] },
        { type: 'orderedList', content: [emptyItem(), emptyItem()] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p()] }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p()] }] },
      ),
    );
    expect(aiDisabledReason({ ...ready, text })).toBe(AI_DISABLED_REASONS.empty);
    expect(aiDisabledReason({ ...ready, text: '- \n☐ [未轉寫片段]\n10.' })).toBe(AI_DISABLED_REASONS.empty);
    expect(aiDisabledReason({ ...ready, text: '- 寄出報價單' })).toBeUndefined();
    expect(aiDisabledReason({ ...ready, text: '2026' })).toBeUndefined();
    expect(aiDisabledReason({ ...ready, text: '-5' })).toBeUndefined();
  });

  it('uses zh-TW reasons', () => {
    expect(AI_DISABLED_REASONS).toEqual({
      recording: '錄音中無法使用 AI 功能',
      notConfigured: '請先在設定填入後端網址與存取金鑰',
      empty: '筆記內容是空的',
    });
  });
});

describe('aiErrorMessage', () => {
  it.each([
    [new ApiError('x', 503, { code: 'ai_unavailable' }), AI_MESSAGES.unavailable],
    [new ApiError('x', 401, { code: 'unauthorized' }), AI_MESSAGES.unauthorized],
    [new ApiError('x', 429, { code: 'rate_limited' }), AI_MESSAGES.rateLimited],
    [new ApiError('x', 413, { code: 'payload_too_large' }), AI_MESSAGES.tooLong],
    [new ApiError('x', 400, { code: 'bad_request' }), AI_MESSAGES.badRequest],
    [new ApiError('x', 0), AI_MESSAGES.network],
    [new ApiError('x', 502, { code: 'upstream_error' }), AI_MESSAGES.failed],
    [new ApiError('Invalid summary response', 200), AI_MESSAGES.failed],
    [new Error('boom'), AI_MESSAGES.failed],
  ])('maps %o to its message', (error, message) => {
    expect(aiErrorMessage(error)).toBe(message);
  });

  it('states the 60,000 character limit', () => {
    expect(AI_MESSAGES.tooLong).toBe('筆記內容超過 60,000 字，無法交給 AI 處理');
  });
});
