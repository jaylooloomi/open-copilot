import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_ENTRY_URL, APP_SCHEME, isAppUrl, resolveAppPath } from './appProtocol';
import { createSaveFileHandler, SAVE_FILE_CHANNEL } from './saveFile';
import { isSystemHandledUrl, shouldGrantPermission } from './security';

// Must run before the app is ready. `standard` + `secure` give app://bundle a real origin and a
// secure context (IndexedDB, crypto.randomUUID, getUserMedia, clipboard all need one).
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

// The e2e tests give every run its own empty profile (IndexedDB, localStorage). A development
// build (`npm run dev`) gets a profile of its own, so it never opens or locks the installed app's notes.
if (process.env.OC_USER_DATA_DIR) {
  app.setPath('userData', process.env.OC_USER_DATA_DIR);
} else if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'open-copilot-dev'));
}

/** The web build: apps/web/dist during development, resources/web in the installed app. */
function webRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.join(__dirname, '..', '..', 'web', 'dist');
}

function registerAppProtocol(rootDir: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const filePath = resolveAppPath(request.url, rootDir);
    if (!filePath) return new Response('Not found', { status: 404 });
    try {
      return await net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function registerPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(shouldGrantPermission(permission, details));
  });
}

function registerSaveFile(): void {
  ipcMain.handle(SAVE_FILE_CHANNEL, (event, filename: unknown, bytes: unknown) => {
    if (!isAppUrl(event.senderFrame?.url ?? '')) {
      throw new Error('oc:save-file is only available to app://bundle pages');
    }
    const owner = BrowserWindow.fromWebContents(event.sender);
    const saveFile = createSaveFileHandler({
      showSaveDialog: (options) =>
        owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options),
      writeFile: (filePath, data) => fs.writeFile(filePath, data),
      defaultDir: () => app.getPath('documents'),
    });
    return saveFile(filename, bytes);
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 360,
    minHeight: 480,
    title: 'open-copilot',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep cutting and uploading segments on time while the window is minimized.
      backgroundThrottling: false,
    },
  });

  // Links in a note (http/https/mailto/tel) go to the system handler; the app window itself never leaves app://bundle.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSystemHandledUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => {
    if (isAppUrl(event.url)) return;
    event.preventDefault();
    if (isSystemHandledUrl(event.url)) void shell.openExternal(event.url);
  });

  void win.loadURL(APP_ENTRY_URL);
  return win;
}

// One app per profile: a second process would find IndexedDB locked (blank window) or, worse,
// overwrite the first one's notes. The lock is keyed on the userData folder set above.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  void app.whenReady().then(() => {
    registerAppProtocol(webRoot());
    registerPermissions();
    registerSaveFile();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
