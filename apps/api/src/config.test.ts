import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_HOST,
  MIN_ACCESS_KEY_LENGTH,
  accessKeyWarning,
  loadConfig,
} from './config';

const base = { GROQ_API_KEY: 'gsk-test', ACCESS_KEYS: 'key-a' };

describe('loadConfig', () => {
  it('refuses to start without any transcription key off Windows', () => {
    for (const env of [
      { ACCESS_KEYS: 'key-a' },
      { ACCESS_KEYS: 'key-a', GROQ_API_KEY: '   ', OPENAI_API_KEY: '' },
    ]) {
      expect(() => loadConfig(env, 'linux')).toThrow(
        'No transcription API key: set GROQ_API_KEY (free key at https://console.groq.com/keys) or OPENAI_API_KEY',
      );
      expect(() => loadConfig(env, 'darwin')).toThrow(
        'the offline TRANSCRIBE_PROVIDER=windows only works on Windows',
      );
    }
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

  it('uses Groq, default origins and default port when only the required values are set', () => {
    const config = loadConfig(base);
    expect(config).toEqual({
      transcriber: { provider: 'groq', apiKey: 'gsk-test', model: 'whisper-large-v3-turbo' },
      ai: { apiKey: 'gsk-test', model: 'openai/gpt-oss-120b' },
      accessKeys: ['key-a'],
      allowedOrigins: [
        'http://localhost:5173',
        'https://localhost',
        'capacitor://localhost',
        'app://bundle',
      ],
      port: 8787,
      host: '127.0.0.1',
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

  it('listens on loopback only unless HOST says otherwise', () => {
    expect(DEFAULT_HOST).toBe('127.0.0.1');
    expect(loadConfig(base).host).toBe('127.0.0.1');
    expect(loadConfig({ ...base, HOST: '   ' }).host).toBe('127.0.0.1');
    expect(loadConfig({ ...base, HOST: ' 0.0.0.0 ' }).host).toBe('0.0.0.0');
    expect(loadConfig({ ...base, HOST: '::' }).host).toBe('::');
  });

  it('falls back to the default port when PORT is blank', () => {
    expect(loadConfig({ ...base, PORT: '   ' }).port).toBe(8787);
  });

  it('rejects PORT values that are not plain decimal digits', () => {
    for (const port of ['0x1F90', '1e3', '3000.0', '+3000', '-1']) {
      expect(() => loadConfig({ ...base, PORT: port }), port).toThrow('PORT');
    }
  });

  it('refuses to start from an unedited copy of .env.example, even after a transcription key is filled in', () => {
    // 範例檔不能帶可用的金鑰：只填轉寫金鑰就上線時，伺服器仍必須因缺存取金鑰而拒絕啟動。
    const example = parseEnv(readFileSync(new URL('../.env.example', import.meta.url), 'utf8'));
    expect(example).toMatchObject({
      TRANSCRIBE_PROVIDER: '',
      GROQ_API_KEY: '',
      GROQ_TRANSCRIBE_MODEL: '',
      GROQ_LLM_MODEL: '',
      OPENAI_API_KEY: '',
      FFMPEG_PATH: '',
      ACCESS_KEYS: '',
    });
    // HOST stays commented out: an empty `HOST=` in `docker run --env-file` would override the
    // image's HOST=0.0.0.0 and leave the container listening on its own loopback only.
    expect(example).not.toHaveProperty('HOST');
    expect(() => loadConfig(example, 'linux')).toThrow('No transcription API key');
    // On Windows the offline provider needs no key, but the missing ACCESS_KEYS still stops it.
    expect(() => loadConfig(example, 'win32')).toThrow('ACCESS_KEYS');
    expect(() => loadConfig({ ...example, GROQ_API_KEY: 'gsk-real' })).toThrow('ACCESS_KEYS');
  });
});

describe('transcription provider', () => {
  it('prefers Groq when TRANSCRIBE_PROVIDER is unset and both keys exist', () => {
    const config = loadConfig({ ...base, OPENAI_API_KEY: 'sk-test' });
    expect(config.transcriber).toEqual({
      provider: 'groq',
      apiKey: 'gsk-test',
      model: 'whisper-large-v3-turbo',
    });
  });

  it('falls back to OpenAI when only OPENAI_API_KEY is set', () => {
    for (const env of [
      { ACCESS_KEYS: 'key-a', OPENAI_API_KEY: ' sk-test ' },
      { ACCESS_KEYS: 'key-a', OPENAI_API_KEY: 'sk-test', GROQ_API_KEY: '  ' },
      { ACCESS_KEYS: 'key-a', OPENAI_API_KEY: 'sk-test', TRANSCRIBE_PROVIDER: '   ' },
    ]) {
      expect(loadConfig(env).transcriber).toEqual({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini-transcribe',
      });
    }
  });

  it('honours an explicit provider, case-insensitively', () => {
    const both = { ...base, OPENAI_API_KEY: 'sk-test' };
    expect(loadConfig({ ...both, TRANSCRIBE_PROVIDER: 'openai' }).transcriber.provider).toBe('openai');
    expect(loadConfig({ ...both, TRANSCRIBE_PROVIDER: ' Groq ' }).transcriber.provider).toBe('groq');
    expect(loadConfig({ ...both, TRANSCRIBE_PROVIDER: 'OPENAI' }).transcriber).toMatchObject({ provider: 'openai', apiKey: 'sk-test' });
  });

  it('requires the key of the explicitly chosen provider', () => {
    expect(() =>
      loadConfig({ ACCESS_KEYS: 'key-a', OPENAI_API_KEY: 'sk-test', TRANSCRIBE_PROVIDER: 'groq' }),
    ).toThrow('GROQ_API_KEY is required when TRANSCRIBE_PROVIDER=groq');
    expect(() => loadConfig({ ...base, TRANSCRIBE_PROVIDER: 'openai' })).toThrow(
      'OPENAI_API_KEY is required when TRANSCRIBE_PROVIDER=openai',
    );
  });

  it('rejects an unknown provider without echoing any key', () => {
    let message = '';
    try {
      loadConfig({ ...base, OPENAI_API_KEY: 'sk-test', TRANSCRIBE_PROVIDER: 'azure' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe('TRANSCRIBE_PROVIDER must be "groq", "openai" or "windows", got "azure"');
    expect(message).not.toContain('gsk-test');
    expect(message).not.toContain('sk-test');
  });

  it('does not echo a TRANSCRIBE_PROVIDER value that looks like a pasted key', () => {
    for (const pasted of ['gsk_abcdefghijklmnop', 'sk-proj-abc', 'abcdefghijklmnopqrstuvwxyz']) {
      let message = '';
      try {
        loadConfig({ ...base, TRANSCRIBE_PROVIDER: pasted });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toBe(
        'TRANSCRIBE_PROVIDER must be "groq", "openai" or "windows", got an unrecognized value (not shown)',
      );
      expect(message).not.toContain(pasted);
    }
  });

  it('lets GROQ_TRANSCRIBE_MODEL override the Groq model', () => {
    expect(loadConfig({ ...base, GROQ_TRANSCRIBE_MODEL: ' whisper-large-v3 ' }).transcriber.model).toBe(
      'whisper-large-v3',
    );
    expect(loadConfig({ ...base, GROQ_TRANSCRIBE_MODEL: '   ' }).transcriber.model).toBe(
      'whisper-large-v3-turbo',
    );
  });

  it('ignores GROQ_TRANSCRIBE_MODEL for OpenAI', () => {
    const config = loadConfig({
      ACCESS_KEYS: 'key-a',
      OPENAI_API_KEY: 'sk-test',
      GROQ_TRANSCRIBE_MODEL: 'whisper-large-v3',
    });
    expect(config.transcriber.model).toBe('gpt-4o-mini-transcribe');
  });
});

describe('windows provider', () => {
  it('falls back to the Windows offline recognizer when no key is set on Windows', () => {
    const config = loadConfig({ ACCESS_KEYS: 'key-a' }, 'win32');
    expect(config.transcriber).toEqual({
      provider: 'windows',
      model: 'System.Speech zh-TW',
      ffmpegPath: 'ffmpeg',
    });
    expect(config.ai).toBeNull();
  });

  it('still prefers a cloud key on Windows', () => {
    expect(loadConfig(base, 'win32').transcriber.provider).toBe('groq');
    expect(
      loadConfig({ ACCESS_KEYS: 'key-a', OPENAI_API_KEY: 'sk-test' }, 'win32').transcriber.provider,
    ).toBe('openai');
  });

  it('honours TRANSCRIBE_PROVIDER=windows even with keys, and reads FFMPEG_PATH', () => {
    const config = loadConfig(
      { ...base, TRANSCRIBE_PROVIDER: ' Windows ', FFMPEG_PATH: ' C:\\ffmpeg\\bin\\ffmpeg.exe ' },
      'win32',
    );
    expect(config.transcriber).toEqual({
      provider: 'windows',
      model: 'System.Speech zh-TW',
      ffmpegPath: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
    });
    // AI stays on Groq whatever the transcriber is.
    expect(config.ai).toEqual({ apiKey: 'gsk-test', model: 'openai/gpt-oss-120b' });
  });

  it('ignores a blank FFMPEG_PATH', () => {
    const config = loadConfig({ ACCESS_KEYS: 'key-a', FFMPEG_PATH: '  ' }, 'win32');
    expect(config.transcriber).toMatchObject({ provider: 'windows', ffmpegPath: 'ffmpeg' });
  });

  it('refuses TRANSCRIBE_PROVIDER=windows off Windows', () => {
    expect(() => loadConfig({ ...base, TRANSCRIBE_PROVIDER: 'windows' }, 'linux')).toThrow(
      'TRANSCRIBE_PROVIDER=windows only works on Windows',
    );
  });
});

describe('AI config', () => {
  it('enables AI with the default Groq LLM when GROQ_API_KEY is set', () => {
    expect(loadConfig(base).ai).toEqual({ apiKey: 'gsk-test', model: 'openai/gpt-oss-120b' });
  });

  it('lets GROQ_LLM_MODEL override the model, ignoring blanks', () => {
    expect(loadConfig({ ...base, GROQ_LLM_MODEL: ' llama-3.3-70b-versatile ' }).ai?.model).toBe(
      'llama-3.3-70b-versatile',
    );
    expect(loadConfig({ ...base, GROQ_LLM_MODEL: '   ' }).ai?.model).toBe('openai/gpt-oss-120b');
  });

  it('disables AI when there is no Groq key, without refusing to start', () => {
    const config = loadConfig({
      ACCESS_KEYS: 'key-a',
      OPENAI_API_KEY: 'sk-test',
      GROQ_API_KEY: '  ',
      GROQ_LLM_MODEL: 'llama-3.3-70b-versatile',
    });
    expect(config.ai).toBeNull();
    expect(config.transcriber.provider).toBe('openai');
  });

  it('keeps AI on Groq even when transcription uses OpenAI', () => {
    const config = loadConfig({ ...base, OPENAI_API_KEY: 'sk-test', TRANSCRIBE_PROVIDER: 'openai' });
    expect(config.transcriber.provider).toBe('openai');
    expect(config.ai).toEqual({ apiKey: 'gsk-test', model: 'openai/gpt-oss-120b' });
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
