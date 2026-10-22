import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const apiDir = fileURLToPath(new URL('..', import.meta.url));

/**
 * 只帶最少的環境變數，以子程序啟動 server.ts（不讀 .env）。
 * 這裡的設定都會在 listen 之前失敗，所以不會佔用 8787。
 */
function startServer(env: Record<string, string>) {
  const baseEnv: Record<string, string> = {};
  for (const name of ['PATH', 'SystemRoot']) {
    const value = process.env[name];
    if (value !== undefined) baseEnv[name] = value;
  }
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: apiDir,
    env: { ...baseEnv, ...env },
    encoding: 'utf8',
    // 比 it() 的 30 秒短，子程序卡住時才會看到 status/stderr 的斷言失敗而非泛用逾時。
    timeout: 25_000,
  });
}

describe('server startup', () => {
  it('exits 1 with a one-line hint when no transcription key is set', () => {
    const result = startServer({ ACCESS_KEYS: 'startup-test-key-0123' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      '[config] No transcription API key: set GROQ_API_KEY (free key at https://console.groq.com/keys) or OPENAI_API_KEY',
    );
    expect(result.stderr).not.toContain('at loadConfig');
  }, 30_000);

  it('exits 1 naming ACCESS_KEYS when only a Groq key is set, without printing the key', () => {
    const result = startServer({ GROQ_API_KEY: 'gsk-startup-secret' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[config] ACCESS_KEYS is required');
    expect(result.stderr).not.toContain('at loadConfig');
    expect(result.stderr).not.toContain('gsk-startup-secret');
    expect(result.stdout).not.toContain('gsk-startup-secret');
  }, 30_000);
});
