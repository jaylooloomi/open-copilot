// npm run prototype: start apps/api (8787) and the Vite dev server (5173) together, then open the
// web app with its settings filled in through #oc-setup (add-ons design 1.3).
//   --no-open  do not open a browser (the setup URL is still printed)
//   --check    start everything, check /health directly, through the Vite /api proxy and (with
//              --share) through the tunnel, then stop
//   --share    also open a Cloudflare quick tunnel to the web app and print a phone URL and a QR
//              code (add-ons design 4)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  API_ORIGIN,
  GROQ_KEY_STEPS,
  PROXY_API_BASE_URL,
  SHARE_WARNING,
  WEB_ORIGIN,
  WINDOWS_HINT,
  apiEnvironment,
  chooseTranscriber,
  cloudflaredArgs,
  ensureAccessKey,
  ensureCloudflaredBin,
  ffmpegUsable,
  loadEnvLayers,
  openBrowserCommand,
  parseFlags,
  renderQr,
  setupUrl,
  shareSetupUrl,
  supervise,
  waitForOk,
  watchTunnel,
} from './prototype/lib.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const apiDir = join(root, 'apps', 'api');
const webDir = join(root, 'apps', 'web');

let options;
try {
  options = parseFlags(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const { checkOnly, openInBrowser, share } = options;

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

// 3. --share needs the cloudflared binary (npm devDependency `cloudflared`), before anything starts.
let cloudflaredBin = null;
if (share) {
  try {
    cloudflaredBin = await ensureCloudflaredBin();
  } catch (error) {
    console.error(`[prototype] 無法取得 cloudflared：${error.message}`);
    process.exit(1);
  }
}

// 4. Both servers (and the tunnel); when one stops, supervise() stops the others.
const apiEnv = apiEnvironment(env, access);
const viteBin = join(
  dirname(createRequire(join(webDir, 'package.json')).resolve('vite/package.json')),
  'bin',
  'vite.js',
);
const children = {
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
};
let tunnelWatch = null;
if (cloudflaredBin) {
  // cloudflared's log (which carries the URL) goes to pipes, not the terminal: it is long and noisy.
  const tunnel = spawn(cloudflaredBin, cloudflaredArgs(WEB_ORIGIN), {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  tunnelWatch = watchTunnel([tunnel.stdout, tunnel.stderr]);
  children.tunnel = tunnel;
}
const supervisor = supervise(children);
const LABELS = { api: '後端', web: '網頁伺服器', tunnel: 'Cloudflare 通道' };

let shuttingDown = false;
let userStopped = false;
const shutDown = () => {
  shuttingDown = true;
  tunnelWatch?.cancel();
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

const isCancelled = () => shuttingDown || supervisor.anyExited;

/**
 * Waits for the tunnel, checks /api/health through it, then prints the phone URL and QR code.
 * @returns {Promise<'ok' | 'unreachable' | 'failed' | 'cancelled'>}
 */
async function startSharing(accessKey) {
  const tunnelOrigin = await Promise.race([tunnelWatch.ready, supervisor.done.then(() => null)]);
  if (isCancelled()) return 'cancelled';
  if (!tunnelOrigin) {
    console.error('[prototype] 等不到 Cloudflare 通道網址，已全部關閉。cloudflared 最後的訊息：');
    for (const line of tunnelWatch.tail()) console.error(`  ${line}`);
    return 'failed';
  }
  const reachable = await waitForOk(`${tunnelOrigin}/api/health`, { isCancelled, intervalMs: 2_000 });
  if (isCancelled()) return 'cancelled';
  const link = shareSetupUrl(tunnelOrigin, accessKey);
  console.log(`[prototype] 手機分享網址（含存取金鑰，只給自己的手機使用）：\n  ${link}`);
  console.log(await renderQr(link));
  console.warn(SHARE_WARNING);
  if (!reachable) {
    console.warn(
      '[prototype] 這台電腦 60 秒內連不到分享網址的 /api/health（可能是 DNS 還沒更新）；' +
        '手機通常仍可開啟，打不開時按 Ctrl+C 後重新執行',
    );
  }
  return reachable ? 'ok' : 'unreachable';
}

// 5. Wait for both (the second check goes through the Vite /api proxy), then share and open the browser.
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
  const shared = tunnelWatch ? await startSharing(access.key) : 'off';
  if (shared === 'cancelled') {
    // Ctrl+C, or a server or the tunnel stopped while sharing started: reported below.
  } else if (shared === 'failed' || (checkOnly && shared === 'unreachable')) {
    if (shared === 'unreachable') console.error('[prototype] --check：分享網址的 /api/health 沒有回應');
    ok = false;
    shutDown();
  } else if (checkOnly) {
    console.log(
      shared === 'ok'
        ? '[prototype] --check：後端、/api proxy 與分享網址都正常，結束'
        : '[prototype] --check：後端與 /api proxy 都正常，結束',
    );
    shutDown();
  } else {
    if (openInBrowser) launchBrowser(url);
    console.log('[prototype] 按 Ctrl+C 結束');
  }
}

const first = await supervisor.done;
if (!shuttingDown) {
  // A child stopped by itself (crash, port in use, tunnel dropped); supervise() already stopped the others.
  console.error(`[prototype] ${LABELS[first.name]}已結束（exit code ${first.code}），其他也一併關閉`);
  // cloudflared's own output is piped; show its last lines so a config.yml clash or network error is visible.
  if (first.name === 'tunnel' && tunnelWatch) for (const line of tunnelWatch.tail()) console.error(`  ${line}`);
  ok = false;
}
// exitCode, not process.exit(): on Windows (Node 24) exiting while the children's handles are
// still closing aborts with a libuv assertion (src/win/async.c) and exit code 127. Both children
// have exited here and nothing else keeps the event loop alive, so the process ends by itself.
process.exitCode = ok ? 0 : 1;
// Safety net: if some stray handle (a future ref'd timer, a socket) keeps the loop alive, exit
// anyway once the children's handles have had time to close. unref() so it never delays a clean exit.
setTimeout(() => process.exit(process.exitCode), 2000).unref();
