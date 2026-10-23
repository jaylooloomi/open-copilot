import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('npm run prototype runs scripts/prototype.mjs', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.prototype, 'node scripts/prototype.mjs');
});

test('the launcher parses', () => {
  const launcher = fileURLToPath(new URL('../prototype.mjs', import.meta.url));
  const result = spawnSync(process.execPath, ['--check', launcher], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('with no usable transcriber the launcher prints the Groq key steps and exits 1 before starting anything', async () => {
  const { GROQ_KEY_STEPS } = await import('./lib.mjs');
  const launcher = fileURLToPath(new URL('../prototype.mjs', import.meta.url));
  // TRANSCRIBE_PROVIDER=windows is "none" off Windows, and on Windows the missing ffmpeg makes it unusable.
  const env = {
    ...process.env,
    TRANSCRIBE_PROVIDER: 'windows',
    FFMPEG_PATH: fileURLToPath(new URL('./no-such-ffmpeg.exe', import.meta.url)),
  };
  const result = spawnSync(process.execPath, [launcher, '--no-open'], {
    encoding: 'utf8',
    env,
    timeout: 30_000,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.ok(result.stderr.includes(GROQ_KEY_STEPS), result.stderr);
  assert.ok(!result.stdout.includes('按 Ctrl+C 結束'), result.stdout);
});

test('the launcher rejects an unknown option before starting anything', () => {
  const launcher = fileURLToPath(new URL('../prototype.mjs', import.meta.url));
  // Same environment as the test above: if options were parsed after the transcriber check, this
  // would still exit 1, but with the Groq steps instead of the option error.
  const env = {
    ...process.env,
    TRANSCRIBE_PROVIDER: 'windows',
    FFMPEG_PATH: fileURLToPath(new URL('./no-such-ffmpeg.exe', import.meta.url)),
  };
  const result = spawnSync(process.execPath, [launcher, '--shar'], { encoding: 'utf8', env, timeout: 30_000 });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /不認得的選項：--shar/);
  assert.ok(!result.stderr.includes('申請免費的 Groq 金鑰'), result.stderr);
});
