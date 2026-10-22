// Structure checks for .github/workflows/ci.yml (add-ons design section 2).
// GitHub only reports a broken workflow after a push, so these checks catch
// typos, missing steps and wrong gates locally first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const repoRoot = new URL('../../', import.meta.url);
const workflowText = readFileSync(new URL('.github/workflows/ci.yml', repoRoot), 'utf8');
const workflow = parse(workflowText);
const rootScripts = JSON.parse(readFileSync(new URL('package.json', repoRoot), 'utf8')).scripts;

// apps/web and apps/desktop live on other branches until they are merged,
// so every step that needs one of them only runs when its package.json exists.
const WEB_GATE = "hashFiles('apps/web/package.json') != ''";
const DESKTOP_GATE = "hashFiles('apps/desktop/package.json') != ''";

function job(name) {
  const found = workflow.jobs?.[name];
  assert.ok(found, `job "${name}" is missing`);
  return found;
}

function isNotice(step) {
  return typeof step.run === 'string' && step.run.trim().startsWith('echo "::notice::');
}

/** The run commands of a job, in order, without the skip notices. */
function commands(jobDef) {
  return jobDef.steps.filter((s) => typeof s.run === 'string' && !isNotice(s)).map((s) => s.run.trim());
}

function stepByRun(jobDef, command) {
  const found = jobDef.steps.find((s) => typeof s.run === 'string' && s.run.trim() === command);
  assert.ok(found, `step "${command}" is missing`);
  return found;
}

function usesIndex(jobDef, action) {
  return jobDef.steps.findIndex((s) => typeof s.uses === 'string' && s.uses.startsWith(`${action}@`));
}

function assertNodeSetup(jobDef) {
  const checkout = usesIndex(jobDef, 'actions/checkout');
  const setup = usesIndex(jobDef, 'actions/setup-node');
  assert.ok(checkout >= 0, 'actions/checkout is missing');
  assert.ok(setup > checkout, 'actions/setup-node must come after actions/checkout');
  const install = jobDef.steps.findIndex((s) => s.run?.trim() === 'npm ci');
  assert.ok(install > setup, 'npm ci must come after actions/setup-node');
  const { with: options } = jobDef.steps[setup];
  assert.ok(options, 'actions/setup-node needs a with block');
  assert.equal(String(options['node-version']), '24');
  assert.equal(options.cache, 'npm');
}

test('runs on a push to any branch and on pull requests', () => {
  assert.deepEqual(workflow.on.push, { branches: ['**'] });
  assert.ok('pull_request' in workflow.on, 'pull_request trigger is missing');
});

test('cancels superseded runs except on main, so every main commit keeps a result', () => {
  assert.equal(workflow.concurrency?.group, 'ci-${{ github.ref }}');
  assert.equal(workflow.concurrency['cancel-in-progress'], "${{ github.ref != 'refs/heads/main' }}");
});

test('web-api runs on ubuntu with Node 24, the npm cache and no Electron download', () => {
  const webApi = job('web-api');
  assert.equal(webApi['runs-on'], 'ubuntu-latest');
  assertNodeSetup(webApi);
  assert.equal(webApi.env?.ELECTRON_SKIP_BINARY_DOWNLOAD, '1');
});

test('web-api runs the CI commands in order', () => {
  assert.deepEqual(commands(job('web-api')), [
    'npm ci',
    'npm run typecheck',
    'npm test',
    'npm run test:workflow',
    'npm run build -w @oc/web',
    'npx playwright install --with-deps chromium',
    'npm run e2e',
    'docker build -f apps/api/Dockerfile .',
  ]);
});

test('web-api only runs the web steps when apps/web exists', () => {
  const webApi = job('web-api');
  const webCommands = ['npm run build -w @oc/web', 'npx playwright install --with-deps chromium', 'npm run e2e'];
  for (const command of commands(webApi)) {
    const expected = webCommands.includes(command) ? WEB_GATE : undefined;
    assert.equal(stepByRun(webApi, command).if, expected, `wrong condition on "${command}"`);
  }
  const notice = webApi.steps.find(isNotice);
  assert.ok(notice, 'skip notice for apps/web is missing');
  assert.equal(notice.if, "hashFiles('apps/web/package.json') == ''");
});

test('web-api uploads the Playwright report for 7 days when the web e2e fails', () => {
  const webApi = job('web-api');
  assert.equal(stepByRun(webApi, 'npm run e2e').id, 'web-e2e');
  const upload = webApi.steps[usesIndex(webApi, 'actions/upload-artifact')];
  assert.ok(upload, 'actions/upload-artifact is missing');
  assert.equal(upload.if, "failure() && steps.web-e2e.outcome == 'failure'");
  assert.match(upload.with.path, /apps\/web\/playwright-report\//);
  assert.equal(upload.with['retention-days'], 7);
});

test('every root npm script the workflow runs exists', () => {
  for (const jobDef of Object.values(workflow.jobs)) {
    for (const command of commands(jobDef)) {
      const match = /^npm run ([\w:-]+)$/.exec(command);
      if (match) assert.ok(rootScripts[match[1]], `root script "${match[1]}" is missing`);
    }
  }
});

test('never runs the real voice test, Android builds or anything that needs secrets', () => {
  // Case-insensitive, so "Android" or "GRADLE" in a comment is caught too.
  const lowered = workflowText.toLowerCase();
  for (const banned of ['e2e:real', 'playwright.real', 'android', 'gradle', 'cap sync', 'secrets.', 'api_key']) {
    assert.ok(!lowered.includes(banned), `ci.yml must not mention "${banned}" in any letter case`);
  }
});

test('desktop runs on Windows with Node 24, the npm cache and the Electron binary', () => {
  const desktop = job('desktop');
  assert.equal(desktop['runs-on'], 'windows-latest');
  assertNodeSetup(desktop);
  assert.equal(desktop.env?.ELECTRON_SKIP_BINARY_DOWNLOAD, undefined);
  assert.equal(workflow.env?.ELECTRON_SKIP_BINARY_DOWNLOAD, undefined);
});

test('desktop builds web and desktop, downloads Electron, then runs the Electron e2e without packaging', () => {
  const desktop = job('desktop');
  assert.deepEqual(commands(desktop), [
    'npm ci',
    'npm run build -w @oc/web',
    'npm run build -w @oc/desktop',
    'npm exec -w @oc/desktop -- install-electron',
    'npx playwright test',
  ]);
  assert.equal(stepByRun(desktop, 'npx playwright test')['working-directory'], 'apps/desktop');
  const text = JSON.stringify(desktop);
  assert.ok(!text.includes('electron-builder') && !text.includes('npm run dist'), 'desktop must not package an installer');
});

test('desktop only runs the desktop steps when apps/desktop exists', () => {
  const desktop = job('desktop');
  for (const command of commands(desktop)) {
    const expected = command === 'npm ci' ? undefined : DESKTOP_GATE;
    assert.equal(stepByRun(desktop, command).if, expected, `wrong condition on "${command}"`);
  }
  const notice = desktop.steps.find(isNotice);
  assert.ok(notice, 'skip notice for apps/desktop is missing');
  assert.equal(notice.if, "hashFiles('apps/desktop/package.json') == ''");
});

test('desktop uploads the Playwright results for 7 days when the Electron e2e fails', () => {
  const desktop = job('desktop');
  assert.equal(stepByRun(desktop, 'npx playwright test').id, 'desktop-e2e');
  const upload = desktop.steps[usesIndex(desktop, 'actions/upload-artifact')];
  assert.ok(upload, 'actions/upload-artifact is missing');
  assert.equal(upload.if, "failure() && steps.desktop-e2e.outcome == 'failure'");
  assert.match(upload.with.path, /apps\/desktop\/test-results\//);
  assert.equal(upload.with['retention-days'], 7);
});
