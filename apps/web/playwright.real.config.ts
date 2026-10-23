import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { REAL_E2E_SUPPORTED } from './e2e-real/realEnv';

// Workers inherit the runner's process.env, so the runner and the workers see the same values.
const accessKey = (process.env['OC_REAL_ACCESS_KEY'] ??= `real-e2e-${randomUUID()}`);
const wavPath = (process.env['OC_REAL_WAV'] ??= join(tmpdir(), `oc-e2e-real-${randomUUID()}`, 'speech.wav'));
const apiDir = fileURLToPath(new URL('../api/', import.meta.url));

/** Real voice e2e (add-ons design 1.4): not part of `npm run e2e` or CI. */
export default defineConfig({
  testDir: './e2e-real',
  timeout: 240_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/real' }]],
  outputDir: 'test-results/real',
  globalSetup: './e2e-real/globalSetup.ts',
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium-real',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-audio-capture=${wavPath}`,
          ],
        },
      },
    },
  ],
  webServer: REAL_E2E_SUPPORTED
    ? [
        {
          // The real backend without apps/api/.env: the provider comes from this shell's environment
          // (GROQ_API_KEY → groq, OPENAI_API_KEY → openai, otherwise the Windows offline recognizer).
          command: 'node --import tsx src/server.ts',
          cwd: apiDir,
          url: 'http://localhost:8787/health',
          reuseExistingServer: false,
          timeout: 60_000,
          stdout: 'pipe',
          env: { ACCESS_KEYS: accessKey, PORT: '8787', ALLOWED_ORIGINS: 'http://localhost:5173' },
        },
        {
          command: 'npm run dev',
          url: 'http://localhost:5173',
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ]
    : [],
});
