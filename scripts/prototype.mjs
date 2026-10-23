// npm run prototype: start apps/api (8787) and the Vite dev server (5173) together, then open the
// web app with its settings filled in through #oc-setup (add-ons design 1.3).
//   --no-open  do not open a browser (the setup URL is still printed)
//   --check    start both, check /health directly and through the Vite /api proxy, then stop
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  API_ORIGIN,
  API_PORT,
  GROQ_KEY_STEPS,
  PROXY_API_BASE_URL,
  WEB_ORIGIN,
  WINDOWS_HINT,
  chooseTranscriber,
  ensureAccessKey,
  ffmpegUsable,
  loadEnvLayers,
  openBrowserCommand,
  setupUrl,
  supervise,
  waitForOk,
} from './prototype/lib.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const apiDir = join(root, 'apps', 'api');
const webDir = join(root, 'apps', 'web');
const flags = new Set(process.argv.slice(2));
const checkOnly = flags.has('--check');
const openInBrowser = !checkOnly && !flags.has('--no-open');

// 1. Transcription service: cloud key → cloud; none → Windows offline (needs ffmpeg);
//    neither → explain how to get a Groq key and exit 1 before starting anything.
const env = loadEnvLayers(process.env, apiDir);
const choice = chooseTranscriber(env, process.platform);
if (choice.kind === 'none') {
  console.error(GROQ_KEY_STEPS);
  process.exit(1);
}
if (choice.kind === 'windows' && !ffmpegUsable(env)) {
  console.error('[prototype] Windows 內建離線辨識需要 ffmpeg（winget install Gyan.FFmpeg 或設定 FFMPEG_PATH）');
  console.error(GROQ_KEY_STEPS);
  process.exit(1);
}
console.log(choice.kind === 'windows' ? WINDOWS_HINT : `[prototype] 轉寫服務：${choice.provider}`);

// 2. Access key: reuse ACCESS_KEYS, or create one in apps/api/.env.local (git-ignored).
const access = ensureAccessKey({ env, envLocalPath: join(apiDir, '.env.local') });
if (access.source === 'created') {
  console.log('[prototype] 已產生存取金鑰並存到 apps/api/.env.local，之後會重複使用');
}

// 3. Both servers; when one stops, supervise() stops the other.
const apiEnv = { ...env, ACCESS_KEYS: env.ACCESS_KEYS ?? access.key, PORT: String(API_PORT) };
const viteBin = join(
  dirname(createRequire(join(webDir, 'package.json')).resolve('vite/package.json')),
  'bin',
  'vite.js',
);
const supervisor = supervise({
  api: spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: apiDir,
    env: apiEnv,
    stdio: ['ignore', 'inherit', 'inherit'],
  }),
  web: spawn(process.execPath, [viteBin], {
    cwd: webDir,
    env: process.env,
    stdio: ['ignore', 'inherit', 'inherit'],
  }),
});
const LABELS = { api: '後端', web: '網頁伺服器' };

let shuttingDown = false;
let userStopped = false;
const shutDown = () => {
  shuttingDown = true;
  supervisor.stopAll();
};
const onSignal = () => {
  if (!userStopped) console.log('[prototype] 正在關閉後端與網頁伺服器…');
  userStopped = true;
  shutDown();
};
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

function launchBrowser(url) {
  const { command, args } = openBrowserCommand(url, process.platform);
  const opener = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
  opener.on('error', () => console.warn('[prototype] 無法自動開啟瀏覽器，請手動開啟上面的網址'));
  opener.unref();
}

// 4. Wait for both (the second check goes through the Vite /api proxy), then open the browser.
const isCancelled = () => shuttingDown || supervisor.anyExited;
const ready =
  (await waitForOk(`${API_ORIGIN}/health`, { isCancelled })) &&
  (await waitForOk(`${PROXY_API_BASE_URL}/health`, { isCancelled }));

let ok = true;
if (!ready) {
  ok = userStopped;
  if (!userStopped) {
    console.error(
      supervisor.anyExited
        ? '[prototype] 後端或網頁伺服器啟動失敗（見上方訊息），已全部關閉'
        : '[prototype] 60 秒內等不到後端或 /api proxy 就緒，已全部關閉',
    );
  }
  shutDown();
} else {
  const url = setupUrl(WEB_ORIGIN, { apiBaseUrl: PROXY_API_BASE_URL, accessKey: access.key });
  console.log(`[prototype] 後端 ${API_ORIGIN}，網頁 ${WEB_ORIGIN}（/api 經 Vite proxy 轉到後端）`);
  console.log(`[prototype] 用這個網址開啟會自動填好設定（含存取金鑰，請勿分享）：\n  ${url}`);
  console.log(
    `[prototype] 桌面版：設定頁的後端網址填 ${API_ORIGIN}，存取金鑰` +
      (access.source === 'created'
        ? '見 apps/api/.env.local 的 ACCESS_KEYS'
        : '用 ACCESS_KEYS 的第一把'),
  );
  if (checkOnly) {
    console.log('[prototype] --check：後端與 /api proxy 都正常，結束');
    shutDown();
  } else {
    if (openInBrowser) launchBrowser(url);
    console.log('[prototype] 按 Ctrl+C 結束');
  }
}

const first = await supervisor.done;
if (!shuttingDown) {
  // A server stopped by itself (crash, port in use); supervise() already stopped the other one.
  console.error(`[prototype] ${LABELS[first.name]}已結束（exit code ${first.code}），另一個也一併關閉`);
  ok = false;
}
// exitCode, not process.exit(): on Windows (Node 24) exiting while the children's handles are
// still closing aborts with a libuv assertion (src/win/async.c) and exit code 127. Both children
// have exited here and nothing else keeps the event loop alive, so the process ends by itself.
process.exitCode = ok ? 0 : 1;
// Safety net: if some stray handle (a future ref'd timer, a socket) keeps the loop alive, exit
// anyway once the children's handles have had time to close. unref() so it never delays a clean exit.
setTimeout(() => process.exit(process.exitCode), 2000).unref();
