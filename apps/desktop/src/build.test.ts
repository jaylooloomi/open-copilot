import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const pkgDir = join(__dirname, '..');
const script = join(pkgDir, 'scripts', 'clean-build.cjs');
const tmpRoots: string[] = [];

afterEach(() => {
  for (const dir of tmpRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('build script', () => {
  it('is wired to the clean-build script', async () => {
    const { default: pkg } = await import('../package.json');
    expect(pkg.scripts.build).toBe('node scripts/clean-build.cjs');
  });

  // Builds into a temporary directory so `npm test` never touches the shared dist/ that a
  // concurrent e2e run or `npm run dist` may be reading.
  it('removes stale files from the output directory so they are not packaged into app.asar', () => {
    const root = mkdtempSync(join(tmpdir(), 'oc-desktop-build-'));
    tmpRoots.push(root);
    const outDir = join(root, 'out');
    mkdirSync(outDir, { recursive: true });
    const stale = join(outDir, 'stale-from-deleted-source.js');
    writeFileSync(stale, '// left over\n');

    execFileSync(process.execPath, [script, outDir], { cwd: pkgDir, stdio: 'pipe' });

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(join(outDir, 'main.js'))).toBe(true);
    expect(existsSync(join(outDir, 'security.test.js'))).toBe(false);
  }, 120_000);
});
