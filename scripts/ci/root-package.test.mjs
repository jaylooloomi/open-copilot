// The M1 and M3a plans check the root package.json with
// `grep -n '"workspaces"' package.json` and expect exactly one line:
//   5:  "workspaces": ["packages/*", "apps/*"],
// npm rewrites package.json as multi-line JSON whenever it adds a dependency,
// so this check catches that reformat before the plan checks do.
// Because the plan checks expect line 5, do not insert keys above "workspaces"
// in package.json; if those plan greps change, relax this to a single-line check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const text = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');

test('root package.json keeps workspaces as a single line on line 5', () => {
  const hits = text
    .split(/\r?\n/)
    .map((line, i) => `${i + 1}:${line}`)
    .filter((line) => line.includes('"workspaces"'));
  assert.deepEqual(hits, ['5:  "workspaces": ["packages/*", "apps/*"],']);
});
