// @vitest-environment node
import { describe, expect, it } from 'vitest';
import defaultConfig from '../playwright.config';
import realConfig from '../playwright.real.config';
import {
  encodeSetupHash,
  KEYWORDS,
  REAL_E2E_SUPPORTED,
  resolveRealProvider,
  SIMPLIFIED_SAMPLES,
  SPEECH_TEXT,
} from '../e2e-real/realEnv';

interface Server {
  url: string;
  reuseExistingServer: boolean;
  env?: Record<string, string>;
}

describe('real voice e2e setup', () => {
  it('stays out of the default e2e run', () => {
    expect(defaultConfig.testDir).toBe('./e2e');
    expect(realConfig.testDir).toBe('./e2e-real');
  });

  it('feeds Chromium the synthesized WAV as its microphone', () => {
    const args = realConfig.projects?.[0]?.use?.launchOptions?.args ?? [];
    expect(args).toContain('--use-fake-ui-for-media-stream');
    expect(args).toContain('--use-fake-device-for-media-stream');
    expect(args).toContain(`--use-file-for-fake-audio-capture=${process.env['OC_REAL_WAV']}`);
  });

  it.runIf(REAL_E2E_SUPPORTED)('starts a fresh backend on 8787 and the Vite dev server', () => {
    const servers = realConfig.webServer as Server[];
    expect(servers.map((s) => s.url)).toEqual(['http://localhost:8787/health', 'http://localhost:5173']);
    expect(servers.every((s) => s.reuseExistingServer === false)).toBe(true);
    expect(servers[0]!.env).toMatchObject({
      ACCESS_KEYS: process.env['OC_REAL_ACCESS_KEY'],
      PORT: '8787',
    });
  });

  it.skipIf(REAL_E2E_SUPPORTED)('starts no servers where the test cannot run', () => {
    expect(realConfig.webServer).toEqual([]);
  });

  it('reports the provider in the backend order', () => {
    expect(resolveRealProvider({ GROQ_API_KEY: 'g', OPENAI_API_KEY: 'o' }, 'linux')).toBe('groq');
    expect(resolveRealProvider({ OPENAI_API_KEY: 'o' }, 'win32')).toBe('openai');
    expect(resolveRealProvider({ GROQ_API_KEY: ' ' }, 'win32')).toBe('windows');
    expect(resolveRealProvider({ TRANSCRIBE_PROVIDER: ' Windows ' }, 'win32')).toBe('windows');
    expect(resolveRealProvider({}, 'linux')).toBeNull();
  });

  it('encodes #oc-setup as base64url JSON', () => {
    const setup = { apiBaseUrl: 'http://localhost:5173/api', accessKey: 'k-0123456789abcdef' };
    const hash = encodeSetupHash(setup);
    expect(hash.startsWith('#oc-setup=')).toBe(true);
    const encoded = hash.slice('#oc-setup='.length);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))).toEqual(setup);
  });

  it('checks keywords that are spoken and simplified samples that are not', () => {
    expect(KEYWORDS).toEqual(['會議', '測試', '版本']);
    for (const keyword of KEYWORDS) expect(SPEECH_TEXT).toContain(keyword);
    for (const sample of SIMPLIFIED_SAMPLES) expect(SPEECH_TEXT).not.toContain(sample);
  });
});
