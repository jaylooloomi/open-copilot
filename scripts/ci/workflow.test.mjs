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
  assert.equal(String(options['node-version']), '24');
  assert.equal(options.cache, 'npm');
}

test('runs on a push to any branch and on pull requests', () => {
  assert.deepEqual(workflow.on.push, { branches: ['**'] });
  assert.ok('pull_request' in workflow.on, 'pull_request trigger is missing');
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
  for (const banned of ['e2e:real', 'playwright.real', 'android', 'gradle', 'cap sync', 'secrets.', 'API_KEY']) {
    assert.ok(!workflowText.includes(banned), `ci.yml must not mention "${banned}"`);
  }
});
