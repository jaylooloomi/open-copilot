import { describe, expect, it } from 'vitest';
import { DEFAULT_ALLOWED_ORIGINS, loadConfig } from './config';

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

  it('splits and trims comma-separated lists', () => {
    const config = loadConfig({
      ...base,
      ACCESS_KEYS: ' key-a , key-b,,',
      ALLOWED_ORIGINS: 'https://notes.example.com, app://bundle ',
    });
    expect(config.accessKeys).toEqual(['key-a', 'key-b']);
    expect(config.allowedOrigins).toEqual(['https://notes.example.com', 'app://bundle']);
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

  it('parses PORT and rejects invalid values', () => {
    expect(loadConfig({ ...base, PORT: '3000' }).port).toBe(3000);
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow('PORT');
    expect(() => loadConfig({ ...base, PORT: '70000' })).toThrow('PORT');
  });
});
