import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pkgDir = join(__dirname, '..');
const distDir = join(pkgDir, 'dist');

describe('build script', () => {
  it('removes stale files from dist so they are not packaged into app.asar', () => {
    mkdirSync(distDir, { recursive: true });
    const stale = join(distDir, 'stale-from-deleted-source.js');
    writeFileSync(stale, '// left over\n');

    execSync('npm run build', { cwd: pkgDir, stdio: 'pipe' });

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(join(distDir, 'main.js'))).toBe(true);
  }, 120_000);
});
