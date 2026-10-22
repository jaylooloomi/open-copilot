import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALLOWED_ORIGINS,
  MIN_ACCESS_KEY_LENGTH,
  accessKeyWarning,
  loadConfig,
} from './config';

const base = { OPENAI_API_KEY: 'sk-test', ACCESS_KEYS: 'key-a' };

describe('loadConfig', () => {
  it('throws when OPENAI_API_KEY is missing or blank', () => {
    expect(() => loadConfig({ ACCESS_KEYS: 'key-a' })).toThrow('OPENAI_API_KEY');
    expect(() => loadConfig({ ...base, OPENAI_API_KEY: '   ' })).toThrow('OPENAI_API_KEY');
  });

  it('throws when ACCESS_KEYS is missing or only separators', () => {
    expect(() => loadConfig({ OPENAI_API_KEY: 'sk-test' })).toThrow('ACCESS_KEYS');
    expect(() => loadConfig({ ...base, ACCESS_KEYS: ' , ,' })).toThrow('ACCESS_KEYS');
  });

  it('rejects access keys with whitespace inside, which a Bearer header can never carry', () => {
    expect(() => loadConfig({ ...base, ACCESS_KEYS: 'key-a,my key' })).toThrow(
      'ACCESS_KEYS entry 2 contains whitespace',
    );
    expect(() => loadConfig({ ...base, ACCESS_KEYS: 'tab\tkey' })).toThrow('whitespace');
  });

  it('splits and trims comma-separated lists', () => {
    const config = loadConfig({
      ...base,
      ACCESS_KEYS: ' key-a , key-b,,',
      ALLOWED_ORIGINS: 'https://notes.example.com, app://bundle ',
    });
    expect(config.accessKeys).toEqual(['key-a', 'key-b']);
    expect(config.allowedOrigins).toEqual(['https://notes.example.com', 'app://bundle']);
  });

  it('drops duplicate access keys and origins', () => {
    const config = loadConfig({
      ...base,
      ACCESS_KEYS: 'dev-key, dev-key ,key-b',
      ALLOWED_ORIGINS: 'app://bundle,app://bundle',
    });
    expect(config.accessKeys).toEqual(['dev-key', 'key-b']);
    expect(config.allowedOrigins).toEqual(['app://bundle']);
  });

  it('uses default origins and port when not set', () => {
    const config = loadConfig(base);
    expect(config).toEqual({
      openaiApiKey: 'sk-test',
      accessKeys: ['key-a'],
      allowedOrigins: [
        'http://localhost:5173',
        'https://localhost',
        'capacitor://localhost',
        'app://bundle',
      ],
      port: 8787,
    });
    expect(config.allowedOrigins).not.toBe(DEFAULT_ALLOWED_ORIGINS);
  });

  it('falls back to default origins when ALLOWED_ORIGINS is only separators', () => {
    expect(loadConfig({ ...base, ALLOWED_ORIGINS: ' , ' }).allowedOrigins).toEqual([
      ...DEFAULT_ALLOWED_ORIGINS,
    ]);
  });

  it('parses PORT and rejects invalid values', () => {
    expect(loadConfig({ ...base, PORT: '3000' }).port).toBe(3000);
    expect(loadConfig({ ...base, PORT: '1' }).port).toBe(1);
    expect(loadConfig({ ...base, PORT: '65535' }).port).toBe(65535);
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow('PORT');
    expect(() => loadConfig({ ...base, PORT: '0' })).toThrow('PORT');
    expect(() => loadConfig({ ...base, PORT: '70000' })).toThrow('PORT');
  });

  it('falls back to the default port when PORT is blank', () => {
    expect(loadConfig({ ...base, PORT: '   ' }).port).toBe(8787);
  });

  it('rejects PORT values that are not plain decimal digits', () => {
    for (const port of ['0x1F90', '1e3', '3000.0', '+3000', '-1']) {
      expect(() => loadConfig({ ...base, PORT: port }), port).toThrow('PORT');
    }
  });

  it('refuses to start from an unedited copy of .env.example', () => {
    // 範例檔不能帶可用的存取金鑰：只換掉 OPENAI_API_KEY 就上線時，伺服器必須拒絕啟動。
    const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    expect(() => loadConfig(parseEnv(example))).toThrow('ACCESS_KEYS');
  });
});

describe('ALLOWED_ORIGINS validation', () => {
  it('accepts bare origins, including ports and the app schemes', () => {
    const origins = [
      'http://localhost:5173',
      'https://localhost',
      'capacitor://localhost',
      'app://bundle',
      'https://notes.example.com',
      'http://127.0.0.1:8080',
    ];
    expect(loadConfig({ ...base, ALLOWED_ORIGINS: origins.join(',') }).allowedOrigins).toEqual(
      origins,
    );
  });

  it.each([
    ['trailing slash', 'https://notes.example.com/', 'https://notes.example.com'],
    ['path', 'https://notes.example.com/app', 'https://notes.example.com'],
    ['query', 'https://notes.example.com?x=1', 'https://notes.example.com'],
    ['upper-case scheme and host', 'HTTPS://Notes.Example.com', 'https://notes.example.com'],
    ['default port spelled out', 'https://notes.example.com:443', 'https://notes.example.com'],
    ['user info', 'https://user@notes.example.com', 'https://notes.example.com'],
    ['app scheme with trailing slash', 'app://bundle/', 'app://bundle'],
    ['capacitor scheme with path', 'capacitor://localhost/index.html', 'capacitor://localhost'],
  ])('rejects an entry with a %s and suggests the origin', (_label, entry, suggestion) => {
    // 瀏覽器送來的 Origin 永遠是小寫、無路徑、無尾斜線；這種值永遠比對不到，CORS 會默默失敗。
    expect(() => loadConfig({ ...base, ALLOWED_ORIGINS: `http://localhost:5173,${entry}` })).toThrow(
      `ALLOWED_ORIGINS entry "${entry}" is not an origin; use "${suggestion}"`,
    );
  });

  it.each(['notes.example.com', '*', 'app://', 'localhost:5173'])(
    'rejects %s, which can never match a browser Origin',
    (entry) => {
      expect(() => loadConfig({ ...base, ALLOWED_ORIGINS: entry })).toThrow('ALLOWED_ORIGINS');
    },
  );
});

describe('accessKeyWarning', () => {
  it('stays quiet when every key is long enough', () => {
    expect(MIN_ACCESS_KEY_LENGTH).toBe(16);
    expect(accessKeyWarning([randomUUID(), 'x'.repeat(MIN_ACCESS_KEY_LENGTH)])).toBeUndefined();
  });

  it('warns about short keys without printing them', () => {
    // 錯誤金鑰的嘗試不計入限流，短金鑰可被線上猜中；但仍允許啟動（各里程碑的人工檢查用 dev-key）。
    expect(loadConfig({ ...base, ACCESS_KEYS: 'dev-key' }).accessKeys).toEqual(['dev-key']);

    const warning = accessKeyWarning(['dev-key', randomUUID()]);
    expect(warning).toContain('1 of 2 ACCESS_KEYS');
    expect(warning).toContain(`shorter than ${MIN_ACCESS_KEY_LENGTH} characters`);
    expect(warning).toContain('randomUUID');
    expect(warning).not.toContain('dev-key');
  });
});
