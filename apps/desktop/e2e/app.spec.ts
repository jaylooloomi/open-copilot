import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const DESKTOP_DIR = path.resolve(__dirname, '..');

/**
 * Starts apps/desktop (dist/main.js + apps/web/dist). With OC_E2E_EXECUTABLE set to the packaged
 * open-copilot.exe, the same tests run against the installed layout (resources/web) instead.
 */
function launch(userDataDir: string): Promise<ElectronApplication> {
  const env = { ...process.env, OC_USER_DATA_DIR: userDataDir } as Record<string, string>;
  // Chromium's fake microphone: getUserMedia works without hardware, and the permission request
  // still goes through main.ts's handler.
  const args = ['--use-fake-device-for-media-stream'];
  // Fail fast when the app cannot start: Electron then shows a modal error box instead of exiting.
  const timeout = 15_000;
  const executablePath = process.env.OC_E2E_EXECUTABLE;
  return executablePath
    ? electron.launch({ executablePath, args, env, timeout })
    : electron.launch({ args: [DESKTOP_DIR, ...args], env, timeout });
}

/**
 * Starts the app once more on the same profile, like a second double-click on the shortcut, and
 * resolves with its exit code ('still running' if it has not exited after 15 seconds).
 */
function launchAgain(userDataDir: string): Promise<number | null | 'still running'> {
  const env = { ...process.env, OC_USER_DATA_DIR: userDataDir };
  const executablePath = process.env.OC_E2E_EXECUTABLE;
  // In Node, the electron package exports the path of electron.exe.
  const [command, args]: [string, string[]] = executablePath
    ? [executablePath, []]
    : [require('electron') as string, [DESKTOP_DIR]];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill();
      resolve('still running');
    }, 15_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/** Titles the app has persisted in IndexedDB (database "open-copilot", store "notes"). */
function savedTitles(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('open-copilot');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('notes', 'readonly').objectStore('notes').getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve((request.result as { title: string }[]).map((note) => note.title));
          };
        };
      }),
  );
}

interface DialogRequest {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

/** Replaces dialog.showSaveDialog in the main process and records the options it receives. */
async function stubSaveDialog(app: ElectronApplication, result: { canceled: boolean; filePath: string }) {
  await app.evaluate(({ dialog }, stubResult) => {
    const requests: unknown[] = [];
    (globalThis as unknown as { ocSaveDialogRequests: unknown[] }).ocSaveDialogRequests = requests;
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      requests.push(args[args.length - 1]); // called as (options) or (window, options)
      return stubResult;
    }) as typeof dialog.showSaveDialog;
  }, result);
}

function saveDialogRequests(app: ElectronApplication): Promise<DialogRequest[]> {
  return app.evaluate(
    () => (globalThis as unknown as { ocSaveDialogRequests: DialogRequest[] }).ocSaveDialogRequests,
  );
}

/** Title 週會紀錄 and one body paragraph 第一點. */
async function writeNote(page: Page) {
  await page.getByRole('textbox', { name: '標題' }).fill('週會紀錄');
  await page.getByRole('textbox', { name: '筆記內文' }).click();
  await page.keyboard.type('第一點');
}

let userDataDir: string;
let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  userDataDir = mkdtempSync(path.join(tmpdir(), 'oc-desktop-e2e-'));
  app = await launch(userDataDir);
  page = await app.firstWindow();
  await expect(page.getByRole('textbox', { name: '標題' })).toBeVisible();
});

test.afterEach(async () => {
  await app?.close(); // undefined when the launch itself failed
  rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('開啟視窗並從 app://bundle 載入網頁版', async () => {
  expect(page.url()).toBe('app://bundle/index.html');
  await expect(page).toHaveTitle('open-copilot');
  await expect(page.getByRole('textbox', { name: '標題' })).toHaveAttribute('placeholder', '請輸入標題..');

  // The page sees only the preload bridge, never Node.
  const exposed = await page.evaluate(() => ({
    bridge: Object.keys((window as unknown as { ocDesktop?: object }).ocDesktop ?? {}),
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
  }));
  expect(exposed).toEqual({ bridge: ['saveFile'], require: 'undefined', process: 'undefined' });

  const appInfo = await app.evaluate(({ app: electronApp, BrowserWindow }) => ({
    // productName: user data lives in %APPDATA%\open-copilot.
    name: electronApp.getName(),
    // Recording must keep its timers running while the window is minimized.
    backgroundThrottling: BrowserWindow.getAllWindows()[0].webContents.getBackgroundThrottling(),
  }));
  expect(appInfo).toEqual({ name: 'open-copilot', backgroundThrottling: false });
});

test('輸入標題後重新載入、重新啟動，標題仍在', async () => {
  const title = page.getByRole('textbox', { name: '標題' });
  await title.fill('桌面版筆記');
  // Wait for the 500ms debounced save to reach IndexedDB.
  await expect.poll(() => savedTitles(page)).toEqual(['桌面版筆記']);

  await page.reload();
  await expect(title).toHaveValue('桌面版筆記');

  await app.close();
  app = await launch(userDataDir);
  page = await app.firstWindow();
  await expect(page.getByRole('textbox', { name: '標題' })).toHaveValue('桌面版筆記');
});

test('輸入後立刻關閉 App，重新啟動後最後的輸入仍在', async () => {
  await page.getByRole('textbox', { name: '標題' }).fill('立刻關閉');
  // No wait for the 500ms debounce: M1's pagehide flush (with tx.commit) must survive app.quit().
  await app.close();

  app = await launch(userDataDir);
  page = await app.firstWindow();
  await expect(page.getByRole('textbox', { name: '標題' })).toHaveValue('立刻關閉');
});

test('再啟動一次：不開第二個 App，既有視窗被帶到前面', async () => {
  await app.evaluate(({ app: electronApp }) => {
    const seen = { secondInstances: 0 };
    (globalThis as unknown as { ocSingleInstance: typeof seen }).ocSingleInstance = seen;
    electronApp.on('second-instance', () => {
      seen.secondInstances += 1;
    });
  });

  // The second process hands over to this one and quits by itself.
  expect(await launchAgain(userDataDir)).toBe(0);

  await expect
    .poll(() =>
      app.evaluate(
        () => (globalThis as unknown as { ocSingleInstance: { secondInstances: number } }).ocSingleInstance.secondInstances,
      ),
    )
    .toBe(1);
  expect(app.windows()).toHaveLength(1);
  // The first app still owns the database and keeps saving.
  await page.getByRole('textbox', { name: '標題' }).fill('仍可編輯');
  await expect.poll(() => savedTitles(page)).toEqual(['仍可編輯']);
});

test('匯出 Markdown 經原生「另存新檔」對話框寫入檔案', async () => {
  const target = path.join(userDataDir, '匯出結果.md');
  await stubSaveDialog(app, { canceled: false, filePath: target });
  await writeNote(page);

  await page.getByRole('button', { name: '匯出' }).click();
  await page.getByRole('menuitem', { name: 'Markdown' }).click();

  await expect(page.getByRole('status')).toHaveText('已匯出 Markdown');
  expect(readFileSync(target, 'utf8')).toBe('# 週會紀錄\n\n第一點\n');
  const [request] = await saveDialogRequests(app);
  expect(path.basename(request.defaultPath ?? '')).toBe('週會紀錄.md');
  expect(request.filters?.[0]).toEqual({ name: 'Markdown', extensions: ['md'] });
});

test('匯出 Word：從 app://bundle 載入 docx 分塊並寫入 .docx', async () => {
  const target = path.join(userDataDir, '匯出結果.docx');
  await stubSaveDialog(app, { canceled: false, filePath: target });
  await writeNote(page);

  await page.getByRole('button', { name: '匯出' }).click();
  await page.getByRole('menuitem', { name: 'Word' }).click();

  await expect(page.getByRole('status')).toHaveText('已匯出 Word');
  expect(readFileSync(target).subarray(0, 2).toString('latin1')).toBe('PK'); // a .docx is a zip file
  const [request] = await saveDialogRequests(app);
  expect(path.basename(request.defaultPath ?? '')).toBe('週會紀錄.docx');
  expect(request.filters?.[0]).toEqual({ name: 'Word 文件', extensions: ['docx'] });
});

test('在「另存新檔」按取消：不寫檔、不顯示訊息', async () => {
  // Record every message the status line shows, however briefly.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { ocStatusTexts: string[] }).ocStatusTexts = seen;
    const status = document.querySelector('.oc-action-status')!;
    new MutationObserver(() => {
      if (status.textContent) seen.push(status.textContent);
    }).observe(status, { childList: true, characterData: true, subtree: true });
  });

  const target = path.join(userDataDir, '不該存在.txt');
  // Even with a path in the result, a cancelled dialog must not write anything.
  await stubSaveDialog(app, { canceled: true, filePath: target });
  await page.getByRole('button', { name: '匯出' }).click();
  await page.getByRole('menuitem', { name: '純文字' }).click();
  await expect.poll(async () => (await saveDialogRequests(app)).length).toBe(1);

  // A successful export afterwards is the barrier: IPC replies arrive in order, so once its
  // message shows, the renderer has finished handling the cancelled one.
  const second = path.join(userDataDir, '第二次.md');
  await stubSaveDialog(app, { canceled: false, filePath: second });
  await page.getByRole('button', { name: '匯出' }).click();
  await page.getByRole('menuitem', { name: 'Markdown' }).click();
  await expect(page.getByRole('status')).toHaveText('已匯出 Markdown');

  expect(existsSync(second)).toBe(true);
  expect(existsSync(target)).toBe(false);
  // Neither 已匯出純文字 nor 匯出失敗，請再試一次 ever appeared for the cancelled export.
  expect(await page.evaluate(() => (window as unknown as { ocStatusTexts: string[] }).ocStatusTexts)).toEqual([
    '已匯出 Markdown',
  ]);
});

test('複製全文寫入系統剪貼簿', async () => {
  await writeNote(page);
  await page.getByRole('button', { name: '複製', exact: true }).click();

  await expect(page.getByRole('status')).toHaveText('已複製全文');
  // Read it back in the main process; the page itself may not read the clipboard.
  const text = await app.evaluate(async ({ clipboard }) => await clipboard.readText());
  expect(text.replaceAll('\r\n', '\n')).toBe('週會紀錄\n\n第一點');
});

test('筆記中的連結交給系統瀏覽器開啟，App 視窗不跳轉', async () => {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as unknown as { ocOpenedUrls: string[] }).ocOpenedUrls = opened;
    shell.openExternal = (async (url: string) => {
      opened.push(url);
    }) as typeof shell.openExternal;
  });
  await page.getByRole('textbox', { name: '筆記內文' }).click();
  // The space after the URL lets Tiptap's autolink turn it into a link.
  await page.keyboard.type('參考 https://example.com/docs 網站');
  await page.getByRole('link', { name: 'https://example.com/docs' }).click();

  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { ocOpenedUrls: string[] }).ocOpenedUrls))
    .toEqual(['https://example.com/docs']);
  expect(app.windows()).toHaveLength(1);
  expect(page.url()).toBe('app://bundle/index.html');
});

test('允許麥克風、拒絕相機', async () => {
  const audioTracks = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const count = stream.getAudioTracks().length;
    stream.getTracks().forEach((track) => track.stop());
    return count;
  });
  expect(audioTracks).toBe(1);

  const camera = await page.evaluate(() =>
    navigator.mediaDevices.getUserMedia({ video: true }).then(
      () => 'granted',
      (error: Error) => error.name,
    ),
  );
  expect(camera).toBe('NotAllowedError');
});
