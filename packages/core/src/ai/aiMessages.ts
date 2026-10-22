import { AI_MAX_TEXT_CHARS, type Note } from '@oc/shared';
import { ApiError } from '../api/apiClient';
import { TRANSCRIPT_GAP_TEXT } from '../export/common';
import { toTxt } from '../export/toTxt';

/** What the AI panel says when a request fails. */
export const AI_MESSAGES = {
  unavailable: '後端尚未啟用 AI 功能（缺少 Groq 金鑰）',
  unauthorized: '存取金鑰錯誤，請重新設定',
  rateLimited: 'AI 請求太頻繁，請稍後再試',
  tooLong: `筆記內容超過 ${AI_MAX_TEXT_CHARS.toLocaleString('en-US')} 字，無法交給 AI 處理`,
  badRequest: '筆記內容是空的，無法交給 AI 處理',
  network: '無法連線到後端，請檢查網路後再試',
  failed: 'AI 處理失敗，請稍後再試',
} as const;

/** Why AI 摘要 and 待辦事項 are disabled, shown as their `title`. */
export const AI_DISABLED_REASONS = {
  recording: '錄音中無法使用 AI 功能',
  notConfigured: '請先在設定填入後端網址與存取金鑰',
  empty: '筆記內容是空的',
} as const;

/**
 * The note body sent to the AI endpoints: the plain-text export without the title (the title is
 * sent on its own). Lists keep their markers, transcript gaps read [未轉寫片段].
 */
export function aiNoteText(note: Note): string {
  return toTxt({ ...note, title: '' });
}

export interface AiAvailability {
  /** A recording runs, is stopping or is waiting for the microphone. */
  recording: boolean;
  /**
   * Backend URL and access key are set (isConfigured). A backend without a Groq key is not known
   * here: it answers 503 ai_unavailable, which the panel reports (AI_MESSAGES.unavailable).
   */
  configured: boolean;
  /** aiNoteText of the open note. */
  text: string;
}

/** The reason the AI buttons are disabled, or undefined when they can be used. */
export function aiDisabledReason({ recording, configured, text }: AiAvailability): string | undefined {
  if (recording) return AI_DISABLED_REASONS.recording;
  if (!configured) return AI_DISABLED_REASONS.notConfigured;
  // Gap markers alone are no content to summarise.
  if (text.replaceAll(TRANSCRIPT_GAP_TEXT, '').trim() === '') return AI_DISABLED_REASONS.empty;
  return undefined;
}

/** The panel message for a failed summarize() / todos() call. */
export function aiErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return AI_MESSAGES.failed;
  if (error.code === 'ai_unavailable') return AI_MESSAGES.unavailable;
  switch (error.status) {
    case 0:
      return AI_MESSAGES.network;
    case 400:
      return AI_MESSAGES.badRequest;
    case 401:
      return AI_MESSAGES.unauthorized;
    case 413:
      return AI_MESSAGES.tooLong;
    case 429:
      return AI_MESSAGES.rateLimited;
    default:
      return AI_MESSAGES.failed;
  }
}
