import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GROQ_KEY_STEPS,
  PROXY_API_BASE_URL,
  WINDOWS_HINT,
  chooseTranscriber,
  encodeSetup,
  apiEnvironment,
  ensureAccessKey,
  ffmpegUsable,
  generateAccessKey,
  loadEnvLayers,
  openBrowserCommand,
  setupUrl,
  supervise,
  waitForOk,
} from './lib.mjs';

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'oc-prototype-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fakeChild() {
  const child = new EventEmitter();
  child.killCount = 0;
  child.kill = () => {
    child.killCount += 1;
    queueMicrotask(() => child.emit('exit', null, 'SIGTERM'));
    return true;
  };
  return child;
}

test('chooseTranscriber follows the backend order: explicit, Groq, OpenAI, Windows', () => {
  assert.deepEqual(chooseTranscriber({ GROQ_API_KEY: 'g', OPENAI_API_KEY: 'o' }, 'linux'), { kind: 'cloud', provider: 'groq' });
  assert.deepEqual(chooseTranscriber({ OPENAI_API_KEY: 'o', GROQ_API_KEY: '  ' }, 'win32'), { kind: 'cloud', provider: 'openai' });
  assert.deepEqual(chooseTranscriber({}, 'win32'), { kind: 'windows' });
  assert.deepEqual(chooseTranscriber({}, 'linux'), { kind: 'none' });
  assert.deepEqual(chooseTranscriber({ TRANSCRIBE_PROVIDER: ' OpenAI ' }, 'linux'), { kind: 'cloud', provider: 'openai' });
  assert.deepEqual(chooseTranscriber({ GROQ_API_KEY: 'g', TRANSCRIBE_PROVIDER: 'windows' }, 'win32'), { kind: 'windows' });
  assert.deepEqual(chooseTranscriber({ TRANSCRIBE_PROVIDER: 'windows' }, 'darwin'), { kind: 'none' });
});

test('ffmpegUsable probes FFMPEG_PATH, falls back to ffmpeg on PATH, and passes on the probe result', () => {
  const probed = [];
  const yes = (path) => {
    probed.push(path);
    return true;
  };
  assert.equal(ffmpegUsable({ FFMPEG_PATH: ' C:\\ffmpeg\\bin\\ffmpeg.exe ' }, yes), true);
  assert.equal(ffmpegUsable({ FFMPEG_PATH: '   ' }, yes), true);
  assert.equal(ffmpegUsable({}, yes), true);
  assert.deepEqual(probed, ['C:\\ffmpeg\\bin\\ffmpeg.exe', 'ffmpeg', 'ffmpeg']);
  assert.equal(ffmpegUsable({}, () => false), false);
});

test('the messages say what the design asks for', () => {
  assert.ok(WINDOWS_HINT.includes('目前使用 Windows 內建離線辨識，設定 GROQ_API_KEY 可提高準確度'));
  assert.ok(GROQ_KEY_STEPS.includes('https://console.groq.com/keys'));
  assert.ok(GROQ_KEY_STEPS.includes('npm run prototype'));
  assert.equal(PROXY_API_BASE_URL, 'http://localhost:5173/api');
});

test('loadEnvLayers: process env > .env.local > .env, and blank values never hide a layer', (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, '.env'), 'GROQ_API_KEY=from-dotenv\nOPENAI_API_KEY=openai-dotenv\nPORT=1\n');
  writeFileSync(join(dir, '.env.local'), 'GROQ_API_KEY=from-local\nOPENAI_API_KEY=\nACCESS_KEYS=local-key\n');
  const env = loadEnvLayers({ PORT: '2', GROQ_API_KEY: '   ' }, dir);
  assert.equal(env.GROQ_API_KEY, 'from-local');
  assert.equal(env.OPENAI_API_KEY, 'openai-dotenv');
  assert.equal(env.ACCESS_KEYS, 'local-key');
  assert.equal(env.PORT, '2');
});

test('loadEnvLayers works without any .env file', (t) => {
  const env = loadEnvLayers({ PATH: 'x' }, tempDir(t));
  assert.deepEqual(env, { PATH: 'x' });
});

test('ensureAccessKey reuses the first ACCESS_KEYS entry without touching files', (t) => {
  const envLocalPath = join(tempDir(t), '.env.local');
  assert.deepEqual(ensureAccessKey({ env: { ACCESS_KEYS: ' , key-1, key-2' }, envLocalPath }), { key: 'key-1', source: 'env' });
  assert.throws(() => readFileSync(envLocalPath), { code: 'ENOENT' });
});

test('ensureAccessKey writes a new key to .env.local once and the next run reuses it', (t) => {
  const dir = tempDir(t);
  const envLocalPath = join(dir, '.env.local');
  writeFileSync(envLocalPath, 'GROQ_API_KEY=gsk-x');
  const first = ensureAccessKey({ env: {}, envLocalPath, createKey: () => 'generated-key-0123456789' });
  assert.deepEqual(first, { key: 'generated-key-0123456789', source: 'created' });
  const text = readFileSync(envLocalPath, 'utf8');
  assert.ok(text.startsWith('GROQ_API_KEY=gsk-x\n'));
  assert.ok(text.endsWith('ACCESS_KEYS=generated-key-0123456789\n'));

  const second = ensureAccessKey({ env: loadEnvLayers({}, dir), envLocalPath, createKey: () => 'never-used' });
  assert.deepEqual(second, { key: 'generated-key-0123456789', source: 'env' });
});

test('ensureAccessKey fills in a blank ACCESS_KEYS line instead of adding a second one', (t) => {
  const envLocalPath = join(tempDir(t), '.env.local');
  writeFileSync(envLocalPath, 'ACCESS_KEYS=\nPORT=8787\n');
  ensureAccessKey({ env: {}, envLocalPath, createKey: () => 'filled-key-0123456789' });
  assert.equal(readFileSync(envLocalPath, 'utf8'), 'ACCESS_KEYS=filled-key-0123456789\nPORT=8787\n');
});

test('generateAccessKey makes 32 URL-safe random characters', () => {
  const a = generateAccessKey();
  const b = generateAccessKey();
  assert.match(a, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(a, b);
});

test('setupUrl puts base64url JSON after #oc-setup=', () => {
  const setup = { apiBaseUrl: PROXY_API_BASE_URL, accessKey: 'k-0123456789abcdef' };
  const url = setupUrl('http://localhost:5173', setup);
  assert.ok(url.startsWith('http://localhost:5173/#oc-setup='));
  const encoded = url.slice('http://localhost:5173/#oc-setup='.length);
  assert.equal(encoded, encodeSetup(setup));
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')), setup);
});

test('openBrowserCommand picks the platform opener and refuses odd URLs', () => {
  const url = 'http://localhost:5173/#oc-setup=abc_-123';
  assert.deepEqual(openBrowserCommand(url, 'win32'), {
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${url}'`],
  });
  assert.deepEqual(openBrowserCommand(url, 'darwin'), { command: 'open', args: [url] });
  assert.deepEqual(openBrowserCommand(url, 'linux'), { command: 'xdg-open', args: [url] });
  assert.throws(() => openBrowserCommand("http://localhost:5173/#x'; calc", 'win32'), /unexpected URL/);
});

test('waitForOk keeps polling until the URL answers 2xx', async () => {
  const answers = [new Error('ECONNREFUSED'), { ok: false }, { ok: true }];
  let calls = 0;
  const ok = await waitForOk('http://localhost:8787/health', {
    sleep: async () => {},
    fetchImpl: async () => {
      const answer = answers[calls++];
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });
  assert.equal(ok, true);
  assert.equal(calls, 3);
});

test('waitForOk gives up after the timeout or when cancelled', async () => {
  let clock = 0;
  const refused = async () => {
    throw new Error('ECONNREFUSED');
  };
  assert.equal(
    await waitForOk('http://x/health', {
      timeoutMs: 1000,
      intervalMs: 400,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      fetchImpl: refused,
    }),
    false,
  );
  assert.equal(await waitForOk('http://x/health', { fetchImpl: refused, isCancelled: () => true }), false);
});

test('supervise stops the other child when one exits and reports the first exit', async () => {
  const api = fakeChild();
  const web = fakeChild();
  const supervisor = supervise({ api, web });
  assert.equal(supervisor.anyExited, false);

  api.emit('exit', 1, null);

  assert.equal(supervisor.anyExited, true);
  assert.equal(web.killCount, 1);
  assert.deepEqual(await supervisor.done, { name: 'api', code: 1 });
  assert.equal(api.killCount, 0);
});

test('supervise treats a child that cannot start as exited', async () => {
  const api = fakeChild();
  const web = fakeChild();
  const supervisor = supervise({ api, web });
  web.emit('error', new Error('spawn ENOENT'));
  assert.equal(api.killCount, 1);
  assert.deepEqual(await supervisor.done, { name: 'web', code: null });
});

test('stopAll kills each running child once', async () => {
  const api = fakeChild();
  const web = fakeChild();
  const supervisor = supervise({ api, web });
  supervisor.stopAll();
  assert.deepEqual(await supervisor.done, { name: 'api', code: null });
  supervisor.stopAll();
  assert.equal(api.killCount, 1);
  assert.equal(web.killCount, 1);
});

test('supervise keeps a running child whose kill() failed, and survives repeated errors', async (t) => {
  t.mock.method(console, 'error', () => {});
  const api = fakeChild();
  const web = fakeChild();
  api.pid = 1234;
  const supervisor = supervise({ api, web });
  api.emit('error', new Error('kill EPERM'));
  api.emit('error', new Error('kill EPERM'));
  assert.equal(supervisor.anyExited, false);
  assert.equal(web.killCount, 0);
  api.emit('exit', 0, null);
  assert.deepEqual(await supervisor.done, { name: 'api', code: 0 });
});

test('ensureAccessKey keeps CRLF line endings when appending', (t) => {
  const envLocalPath = join(tempDir(t), '.env.local');
  writeFileSync(envLocalPath, 'GROQ_API_KEY=gsk-x\r\nPORT=8787');
  ensureAccessKey({ env: {}, envLocalPath, createKey: () => 'crlf-key-0123456789' });
  assert.equal(
    readFileSync(envLocalPath, 'utf8'),
    'GROQ_API_KEY=gsk-x\r\nPORT=8787\r\n# Written by npm run prototype; reused on every run.\r\nACCESS_KEYS=crlf-key-0123456789\r\n',
  );
});

test('apiEnvironment gives the backend the key the setup link carries', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'oc-proto-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const envLocalPath = join(dir, '.env.local');

  // ACCESS_KEYS made of separators only has no key: the launcher creates one and the backend must get it.
  for (const blank of [',', ' , ']) {
    const env = { ACCESS_KEYS: blank, OTHER: 'x' };
    const access = ensureAccessKey({ env, envLocalPath, createKey: () => 'created-key-0123456789' });
    assert.equal(access.source, 'created');
    assert.deepEqual(apiEnvironment(env, access), {
      ACCESS_KEYS: 'created-key-0123456789',
      OTHER: 'x',
      PORT: '8787',
    });
  }

  // A usable ACCESS_KEYS list is passed on unchanged (the link uses its first entry).
  const env = { ACCESS_KEYS: ' , key-1, key-2' };
  const access = ensureAccessKey({ env, envLocalPath });
  assert.deepEqual(apiEnvironment(env, access), { ACCESS_KEYS: ' , key-1, key-2', PORT: '8787' });
  assert.deepEqual(apiEnvironment({}, { key: 'new-key', source: 'created' }), {
    ACCESS_KEYS: 'new-key',
    PORT: '8787',
  });
});
