import { describe, expect, it } from 'vitest';
import {
  AI_MAX_TEXT_CHARS,
  AI_UPSTREAM_TIMEOUT_MS,
  type AiRequest,
  type AiSummaryResponse,
  type AiTodosResponse,
  type ApiErrorBody,
} from './index';

describe('@oc/shared AI types', () => {
  it('exposes the AI limits shared by the backend and the frontend', () => {
    expect(AI_MAX_TEXT_CHARS).toBe(60_000);
    expect(AI_UPSTREAM_TIMEOUT_MS).toBe(60_000);
  });

  it('types describe AI payloads and the ai_unavailable error', () => {
    const req: AiRequest = { title: '週會', text: '下週三前寄出報價單' };
    const summary: AiSummaryResponse = { summary: '• 下週三前寄出報價單' };
    const todos: AiTodosResponse = { items: ['寄出報價單'] };
    const err: ApiErrorBody = { error: 'ai_unavailable' };
    expect([req.title, summary.summary, todos.items[0], err.error]).toEqual([
      '週會',
      '• 下週三前寄出報價單',
      '寄出報價單',
      'ai_unavailable',
    ]);
  });
});
