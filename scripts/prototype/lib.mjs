// Helpers for scripts/prototype.mjs (add-ons design 1.3). No side effects at import time,
// so scripts/prototype/lib.test.mjs can test them with node:test.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import QRCode from 'qrcode';

export const API_PORT = 8787;
export const WEB_PORT = 5173;
export const API_ORIGIN = `http://localhost:${API_PORT}`;
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
/** Same-origin backend through the Vite proxy (apps/web/vite.config.ts), so the web app needs no CORS. */
export const PROXY_API_BASE_URL = `${WEB_ORIGIN}/api`;

export const WINDOWS_HINT = '[prototype] 目前使用 Windows 內建離線辨識，設定 GROQ_API_KEY 可提高準確度';

export const GROQ_KEY_STEPS = [
  '[prototype] 找不到可用的轉寫服務：沒有 GROQ_API_KEY 或 OPENAI_API_KEY，而且無法使用 Windows 內建離線辨識（不是 Windows，或找不到 ffmpeg）。',
  '申請免費的 Groq 金鑰：',
  '  1. 到 https://console.groq.com/keys 註冊或登入。',
  '  2. 按「Create API Key」，複製 gsk_ 開頭的金鑰（只會顯示一次）。',
  '  3. 在 apps/api/.env.local 加一行 GROQ_API_KEY=<你的金鑰>（或設成環境變數）。',
  '  4. 重新執行 npm run prototype。',
].join('\n');

/** Non-blank values only: `NAME=` means "not set", like apps/api/src/config.ts. */
function nonBlank(values) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => typeof value === 'string' && value.trim() !== ''),
  );
}

function readEnvFile(path) {
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
}

/**
 * The environment the backend will get: process env first, then apps/api/.env.local (written by
 * this launcher), then apps/api/.env (the user's own). Blank values never hide a later layer.
 */
export function loadEnvLayers(processEnv, apiDir) {
  return {
    ...nonBlank(readEnvFile(join(apiDir, '.env'))),
    ...nonBlank(readEnvFile(join(apiDir, '.env.local'))),
    ...nonBlank(processEnv),
  };
}

/**
 * Which transcription service the backend will pick, in the order of loadConfig in
 * apps/api/src/config.ts: an explicit TRANSCRIBE_PROVIDER, then Groq, then OpenAI, then (on Windows
 * only) the built-in offline recognizer. The backend still validates the explicit value.
 * @returns {{ kind: 'cloud', provider: string } | { kind: 'windows' } | { kind: 'none' }}
 */
export function chooseTranscriber(env, platform) {
  const explicit = env.TRANSCRIBE_PROVIDER?.trim().toLowerCase();
  if (explicit === 'windows') return platform === 'win32' ? { kind: 'windows' } : { kind: 'none' };
  if (explicit) return { kind: 'cloud', provider: explicit };
  if (env.GROQ_API_KEY?.trim()) return { kind: 'cloud', provider: 'groq' };
  if (env.OPENAI_API_KEY?.trim()) return { kind: 'cloud', provider: 'openai' };
  if (platform === 'win32') return { kind: 'windows' };
  return { kind: 'none' };
}

/**
 * Whether the ffmpeg the windows provider will use (FFMPEG_PATH, else `ffmpeg` on PATH) runs.
 * Checked before starting anything, so a missing ffmpeg gets the Groq-key steps instead of a
 * backend that exits with "[config] ffmpeg not found". `probe` is injected by tests.
 */
export function ffmpegUsable(
  env,
  probe = (path) => spawnSync(path, ['-version'], { stdio: 'ignore', windowsHide: true }).status === 0,
) {
  return probe(env.FFMPEG_PATH?.trim() || 'ffmpeg');
}

/** 32 URL-safe random characters: no whitespace or commas, so ACCESS_KEYS accepts it. */
export function generateAccessKey() {
  return randomBytes(24).toString('base64url');
}

/**
 * The access key the browser will use. The first ACCESS_KEYS entry (from the environment or
 * apps/api/.env(.local)) wins; otherwise a new random key is saved to envLocalPath and reused.
 * @returns {{ key: string, source: 'env' | 'created' }}
 */
export function ensureAccessKey({ env, envLocalPath, createKey = generateAccessKey }) {
  const existing = (env.ACCESS_KEYS ?? '')
    .split(',')
    .map((key) => key.trim())
    .find((key) => key !== '');
  if (existing) return { key: existing, source: 'env' };

  const key = createKey();
  const line = `ACCESS_KEYS=${key}`;
  const before = existsSync(envLocalPath) ? readFileSync(envLocalPath, 'utf8') : '';
  let text;
  if (/^ACCESS_KEYS=.*$/m.test(before)) {
    // Only a blank ACCESS_KEYS= can be here (a filled one was returned above).
    text = before.replace(/^ACCESS_KEYS=.*$/m, line);
  } else {
    const eol = before.includes('\r\n') ? '\r\n' : '\n';
    const separator = before === '' || before.endsWith('\n') ? '' : eol;
    text = `${before}${separator}# Written by npm run prototype; reused on every run.${eol}${line}${eol}`;
  }
  writeFileSync(envLocalPath, text, 'utf8');
  return { key, source: 'created' };
}

/**
 * The backend's environment. ACCESS_KEYS is passed on only when ensureAccessKey took the key from
 * it; otherwise (unset, or separators only like ",") the backend gets the key the setup link carries.
 */
export function apiEnvironment(env, access) {
  return {
    ...env,
    ACCESS_KEYS: access.source === 'env' ? env.ACCESS_KEYS : access.key,
    PORT: String(API_PORT),
  };
}

/** base64url(JSON) without padding, as packages/core/src/settings/setupLink.ts decodes it. */
export function encodeSetup({ apiBaseUrl, accessKey }) {
  return Buffer.from(JSON.stringify({ apiBaseUrl, accessKey }), 'utf8').toString('base64url');
}

export function setupUrl(webOrigin, setup) {
  return `${webOrigin}/#oc-setup=${encodeSetup(setup)}`;
}

/** The command that opens `url` in the default browser. The URL is never echoed in errors (it holds a key). */
export function openBrowserCommand(url, platform) {
  if (!/^https?:\/\/[\w.:/#=-]+$/.test(url)) throw new Error('refusing to open an unexpected URL');
  if (platform === 'win32') {
    // Start-Process keeps the #fragment; the URL has no quotes (checked above).
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${url}'`],
    };
  }
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

/** Polls `url` until it answers 2xx (true), the timeout passes or isCancelled() (false). */
export async function waitForOk(
  url,
  {
    timeoutMs = 60_000,
    intervalMs = 500,
    fetchImpl = fetch,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    isCancelled = () => false,
  } = {},
) {
  const deadline = now() + timeoutMs;
  while (!isCancelled()) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return true;
    } catch {
      // Not listening yet.
    }
    if (now() >= deadline) return false;
    await sleep(intervalMs);
  }
  return false;
}

/**
 * Watches child processes: when the first one exits (or cannot start), the others are killed.
 * `done` resolves once every child has exited, with the name and exit code of the first one.
 */
export function supervise(children) {
  const entries = Object.entries(children);
  const exited = new Set();
  let first;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const killed = new Set();
  const stopAll = () => {
    for (const [name, child] of entries) {
      if (exited.has(name) || killed.has(name)) continue;
      killed.add(name);
      child.kill();
    }
  };
  const settle = (name, code) => {
    if (exited.has(name)) return;
    exited.add(name);
    if (!first) {
      first = { name, code };
      stopAll();
    }
    if (exited.size === entries.length) resolveDone(first);
  };
  for (const [name, child] of entries) {
    child.once('exit', (code) => settle(name, code));
    // 'error' also fires when kill() or send() fails on a running child; only a child that never
    // started (no pid) counts as exited. on(), so a repeated error is never unhandled.
    child.on('error', (error) => {
      if (child.pid === undefined) settle(name, null);
      else console.error(`[prototype] ${name}: ${error.message}`);
    });
  }
  return {
    done,
    stopAll,
    get anyExited() {
      return exited.size > 0;
    },
  };
}

// --- npm run prototype -- --share (add-ons design 4) ---

export const LAUNCHER_FLAGS = ['--no-open', '--check', '--share'];

/**
 * Launcher options. Unknown flags throw before anything starts, so a typo such as --shar never
 * silently runs a session without the share URL.
 * @returns {{ checkOnly: boolean, openInBrowser: boolean, share: boolean }}
 */
export function parseFlags(argv) {
  const unknown = argv.filter((arg) => !LAUNCHER_FLAGS.includes(arg));
  if (unknown.length > 0) {
    throw new Error(
      `[prototype] 不認得的選項：${unknown.join(' ')}（可用的選項：${LAUNCHER_FLAGS.join('、')}）`,
    );
  }
  const checkOnly = argv.includes('--check');
  return {
    checkOnly,
    openInBrowser: !checkOnly && !argv.includes('--no-open'),
    share: argv.includes('--share'),
  };
}

export const SHARE_WARNING =
  '[prototype] 注意：分享網址是公開的，請只在測試時開啟，用完按 Ctrl+C 關閉；後端仍然需要存取金鑰。';

/** `cloudflared tunnel --url <target>`: a Cloudflare quick tunnel, no account needed. */
export function cloudflaredArgs(target) {
  return ['tunnel', '--no-autoupdate', '--url', target];
}

/** The quick tunnel URL cloudflared prints in a box; api.trycloudflare.com is its own API. */
export const TUNNEL_URL_PATTERN = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/;
/** Logged once an edge connection is up; querying the new hostname before that risks a cached NXDOMAIN. */
export const TUNNEL_CONNECTED_PATTERN = /Registered tunnel connection/i;

export function findTunnelUrl(line) {
  return TUNNEL_URL_PATTERN.exec(line)?.[0] ?? null;
}

/**
 * Reads cloudflared's output. `ready` resolves with the tunnel URL once the URL and a registered
 * connection have both been logged, or with null when every stream ends, `timeoutMs` passes or
 * cancel() is called. tail() returns the last `tailLines` non-blank lines for error messages.
 * The streams keep being read after `ready`, so cloudflared never blocks on a full pipe. A stream
 * error counts as the stream closing; a line longer than `maxLineLength` is cut to that length.
 */
export function watchTunnel(streams, { timeoutMs = 90_000, tailLines = 20, maxLineLength = 8_192 } = {}) {
  const tail = [];
  let url = null;
  let connected = false;
  let settled = false;
  let open = streams.length;
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const finish = (value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolveReady(value);
  };
  const timer = setTimeout(() => finish(null), timeoutMs);
  const onLine = (whole) => {
    const line = whole.slice(0, maxLineLength);
    if (line.trim() === '') return;
    tail.push(line);
    if (tail.length > tailLines) tail.shift();
    url ??= findTunnelUrl(line);
    if (TUNNEL_CONNECTED_PATTERN.test(line)) connected = true;
    if (url && connected) finish(url);
  };
  for (const stream of streams) {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) onLine(line);
      // A line with no newline yet keeps only what onLine would keep.
      if (buffer.length > maxLineLength) buffer = buffer.slice(0, maxLineLength);
    });
    const flush = () => {
      if (buffer !== '') onLine(buffer);
      buffer = '';
    };
    stream.on('end', flush);
    // A broken pipe must not crash the launcher; 'close' follows and settles `ready`.
    stream.on('error', () => {});
    stream.on('close', () => {
      flush();
      open -= 1;
      if (open === 0) finish(null);
    });
  }
  if (streams.length === 0) finish(null);
  return { ready, tail: () => [...tail], cancel: () => finish(null) };
}

/** The phone's link: the tunnel origin with #oc-setup pointing at <tunnel>/api (same origin). */
export function shareSetupUrl(tunnelOrigin, accessKey) {
  return setupUrl(tunnelOrigin, { apiBaseUrl: `${tunnelOrigin}/api`, accessKey });
}

/** A QR code made of block characters, for the phone camera. `toString` is injected by tests. */
export function renderQr(text, toString = (value, options) => QRCode.toString(value, options)) {
  return toString(text, { type: 'terminal', small: true });
}

/**
 * Path of the cloudflared binary from the `cloudflared` npm package (its postinstall downloads
 * it); downloads it now if it is missing. `load`, `exists` and `log` are injected by tests.
 */
export async function ensureCloudflaredBin({
  load = () => import('cloudflared'),
  exists = existsSync,
  log = (message) => console.log(message),
} = {}) {
  const mod = await load();
  const { bin, install } = typeof mod.install === 'function' ? mod : mod.default;
  if (!exists(bin)) {
    log('[prototype] 找不到 cloudflared，正在下載（只有第一次需要）…');
    await install(bin);
  }
  return bin;
}
