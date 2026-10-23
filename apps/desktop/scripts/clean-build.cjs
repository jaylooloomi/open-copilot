// Compiles src/ into a fresh output directory (default: dist) so files from deleted sources
// never linger and get packaged into app.asar. Usage: node scripts/clean-build.cjs [outDir]
const { execFileSync } = require('node:child_process');
const { rmSync } = require('node:fs');
const path = require('node:path');

const pkgDir = path.join(__dirname, '..');
const outDir = path.resolve(pkgDir, process.argv[2] ?? 'dist');

rmSync(outDir, { recursive: true, force: true });
const tsc = require.resolve('typescript/bin/tsc', { paths: [pkgDir] });
execFileSync(process.execPath, [tsc, '-p', path.join(pkgDir, 'tsconfig.build.json'), '--outDir', outDir], {
  cwd: pkgDir,
  stdio: 'inherit',
});
