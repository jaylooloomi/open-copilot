import { describe, expect, it } from 'vitest';
import { AiOutputError, MAX_TODO_ITEMS, normalizeSummary, parseTodoItems } from './output';

describe('normalizeSummary', () => {
  it('trims the summary', () => {
    expect(normalizeSummary('\n• 重點一\n• 重點二  \n')).toBe('• 重點一\n• 重點二');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['whitespace', ' \n '],
  ] as const)('throws AiOutputError for %s', (_label, content) => {
    expect(() => normalizeSummary(content)).toThrow(AiOutputError);
    expect(() => normalizeSummary(content)).toThrow('LLM returned an empty summary');
  });
});

describe('parseTodoItems', () => {
  it('returns the items of a valid JSON object', () => {
    expect(parseTodoItems('{"items":["寄出報價單","確認場地"]}')).toEqual(['寄出報價單', '確認場地']);
  });

  it('accepts an empty list', () => {
    expect(parseTodoItems('{"items":[]}')).toEqual([]);
  });

  it('ignores other fields', () => {
    expect(parseTodoItems('{"items":["訂便當"],"note":"x"}')).toEqual(['訂便當']);
  });

  it('trims items, strips list markers and checkboxes, and drops blanks and duplicates', () => {
    const content = JSON.stringify({
      items: [
        '  寄出報價單 ',
        '- [ ] 確認場地',
        '* 訂便當',
        '• 回覆客戶',
        '1. 整理會議紀錄',
        '2) 更新時程',
        '3、聯絡廠商',
        '[x] 已預約會議室',
        '☐ 準備簡報',
        '☑ 送出申請',
        '   ',
        '寄出報價單',
      ],
    });
    expect(parseTodoItems(content)).toEqual([
      '寄出報價單',
      '確認場地',
      '訂便當',
      '回覆客戶',
      '整理會議紀錄',
      '更新時程',
      '聯絡廠商',
      '已預約會議室',
      '準備簡報',
      '送出申請',
    ]);
  });

  it('keeps dates and numbers that are part of the task', () => {
    expect(parseTodoItems('{"items":["2026.10.30 前交報告","3 月 5 日前寄出"]}')).toEqual([
      '2026.10.30 前交報告',
      '3 月 5 日前寄出',
    ]);
  });

  it(`keeps at most ${MAX_TODO_ITEMS} items`, () => {
    const items = Array.from({ length: MAX_TODO_ITEMS + 10 }, (_, i) => `事項 ${i + 1}`);
    const result = parseTodoItems(JSON.stringify({ items }));
    expect(result).toHaveLength(MAX_TODO_ITEMS);
    expect(result[0]).toBe('事項 1');
    expect(result[MAX_TODO_ITEMS - 1]).toBe(`事項 ${MAX_TODO_ITEMS}`);
  });

  it.each([
    ['null content', null, 'LLM returned no content'],
    ['empty content', '  ', 'LLM returned no content'],
    ['text that is not JSON', '待辦：寄出報價單', 'LLM returned invalid JSON'],
    ['a JSON array', '["寄出報價單"]', 'LLM JSON is not an object'],
    ['a JSON string', '"寄出報價單"', 'LLM JSON is not an object'],
    ['JSON null', 'null', 'LLM JSON is not an object'],
    ['an object without items', '{"todos":["寄出報價單"]}', 'LLM JSON has no "items" array'],
    ['items that is not an array', '{"items":"寄出報價單"}', 'LLM JSON has no "items" array'],
    ['a non-string item', '{"items":["寄出報價單",3]}', 'LLM "items" must be strings'],
    ['an object item', '{"items":[{"text":"寄出報價單"}]}', 'LLM "items" must be strings'],
  ] as const)('throws AiOutputError for %s', (_label, content, message) => {
    expect(() => parseTodoItems(content)).toThrow(AiOutputError);
    expect(() => parseTodoItems(content)).toThrow(message);
  });

  it('never puts the model output in the error message', () => {
    const err = (() => {
      try {
        parseTodoItems('機密內容不是 JSON');
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(err).toBeInstanceOf(AiOutputError);
    expect((err as Error).name).toBe('AiOutputError');
    expect((err as Error).message).not.toContain('機密內容');
  });
});
