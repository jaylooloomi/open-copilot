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
