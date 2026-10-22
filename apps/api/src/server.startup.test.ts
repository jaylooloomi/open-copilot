import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const apiDir = fileURLToPath(new URL('..', import.meta.url));

/**
 * 只帶最少的環境變數，以子程序啟動 server.ts（不讀 .env）。
 * 這裡的設定都會在 listen 之前失敗，所以不會佔用 8787。
 */
function startServer(env: Record<string, string>) {
  const baseEnv = baseEnvVars();
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: apiDir,
    env: { ...baseEnv, ...env },
    encoding: 'utf8',
    // 比 it() 的 30 秒短，子程序卡住時才會看到 status/stderr 的斷言失敗而非泛用逾時。
    timeout: 25_000,
  });
}

function baseEnvVars(): Record<string, string> {
  const baseEnv: Record<string, string> = {};
  for (const name of ['PATH', 'SystemRoot']) {
    const value = process.env[name];
    if (value !== undefined) baseEnv[name] = value;
  }
  return baseEnv;
}

/** 向系統要一個空閒的連接埠，避免和其他 worktree 共用的 8787 衝突。 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * 以子程序啟動 server.ts，等到 stdout 出現 [ai] 那一行（或子程序結束）就收掉，
 * 回傳目前收到的 stdout/stderr。
 */
async function startServerUntilAiLine(
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string }> {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: apiDir,
    env: { ...baseEnvVars(), ...env, PORT: String(port) },
  });
  let stdout = '';
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  try {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 25_000);
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk;
        if (/\[ai\][^\n]*\n/.test(stdout)) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }
  }
  return { stdout, stderr };
}

describe('server startup', () => {
  it('logs the AI provider and model without printing the Groq key', async () => {
    const { stdout, stderr } = await startServerUntilAiLine({
      GROQ_API_KEY: 'gsk-startup-ai-secret',
      GROQ_LLM_MODEL: 'startup-test-llm',
      ACCESS_KEYS: 'startup-test-key-0123',
    });

    expect(stdout).toContain('[ai] provider groq, model startup-test-llm');
    expect(stdout).not.toContain('gsk-startup-ai-secret');
    expect(stderr).not.toContain('gsk-startup-ai-secret');
  }, 30_000);

  it('logs that the AI assistant is disabled when only an OpenAI key is set', async () => {
    const { stdout, stderr } = await startServerUntilAiLine({
      OPENAI_API_KEY: 'sk-startup-openai-secret',
      ACCESS_KEYS: 'startup-test-key-0123',
    });

    expect(stdout).toContain('[ai] disabled: set GROQ_API_KEY');
    expect(stdout).not.toContain('sk-startup-openai-secret');
    expect(stderr).not.toContain('sk-startup-openai-secret');
  }, 30_000);

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
