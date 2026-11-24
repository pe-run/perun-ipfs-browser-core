import { prepareProfile } from './storage/profile';
import { t, isLanguage } from '../shared/i18n';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  protocol,
  session,
  dialog,
} from 'electron';
import { join } from 'node:path';
import { Store } from './storage/store';
import { BrowserController } from './browser/controller';
import { KuboEngine } from './ipfs/engine';
import { installP2P } from './ipfs/protocol';
import { installLocalFiles } from './files/protocol';
import { securePreferences, secureSession } from './security/policy';
import type { Command } from '../shared/types';
protocol.registerSchemesAsPrivileged([
  ...['ipfs', 'ipns'].map((scheme) => ({
    scheme,
    // Keep the authority case-sensitive for base58 CIDv0.
    privileges: {
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  })),
  {
    scheme: 'p2p',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      allowServiceWorkers: false,
    },
  },
]);
// Configure all mutable paths synchronously before Electron initializes sessions.
let profileError: unknown;
let paths: ReturnType<typeof prepareProfile>;
try {
  paths = prepareProfile({
    home: app.getPath('home'),
    override: process.env.IPFS_BROWSER_PROFILE,
  });
  app.setPath('userData', paths.profile);
  app.setPath('sessionData', paths.profile);
  app.setPath('temp', paths.temporary);
  app.setPath('crashDumps', paths.crashes);
  app.setAppLogsPath(paths.logs);
  process.env.TMPDIR = paths.temporary;
} catch (error) {
  profileError = error;
}
if (!profileError && !app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0];
  window?.show();
  window?.focus();
});
let controller: BrowserController | undefined,
  engine: KuboEngine | undefined,
  store: Store | undefined;
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  // A failing step must not prevent the remaining cleanup or the final quit.
  const step = async (name: string, action: () => unknown) => {
    try {
      await action();
    } catch (error) {
      console.error(`Shutdown (${name}):`, error);
    }
  };
  void (async () => {
    await step('browser', () => controller?.destroy());
    await step('kubo', () => engine?.stop());
    await step('store', () => store?.close());
    app.quit();
  })();
});
process.on('SIGTERM', () => app.quit());
process.on('SIGINT', () => app.quit());
app.on('window-all-closed', () => app.quit());
app
  .whenReady()
  .then(async () => {
    if (profileError) throw profileError;
    store = new Store(join(paths.profile, 'browser.sqlite'), paths.bookmarks);
    const content = session.fromPartition('persist:browsing');
    secureSession(content);
    engine = new KuboEngine(
      app.isPackaged
        ? join(process.resourcesPath, 'ipfs')
        : join(app.getAppPath(), 'resources/kubo/ipfs'),
      join(app.getPath('userData'), 'ipfs'),
      process.env.IPFS_BROWSER_OFFLINE === '1',
    );
    // A failed first start is shown in the interface and can be retried there.
    const startup = engine.start().catch((e) => console.error('Kubo:', e));
    installP2P(content, engine, startup);
    installLocalFiles(content);
    const window = new BrowserWindow({
      width: 1250,
      height: 850,
      minWidth: 760,
      minHeight: 400,
      title: 'Perun IPFS Browser',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#202b3a', symbolColor: '#e8edf4', height: 32 },
      icon: app.isPackaged
        ? join(process.resourcesPath, 'branding/perun.png')
        : join(app.getAppPath(), 'resources/branding/perun.png'),
      webPreferences: {
        ...securePreferences,
        preload: join(__dirname, 'index.cjs'),
        partition: 'persist:interface',
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const uiURL = MAIN_WINDOW_VITE_DEV_SERVER_URL || '';
    const uiFile = join(
      __dirname,
      `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
    );
    // Only the top frame of the single browser chrome can call IPC.
    const trustedURL = uiURL || new URL(`file://${uiFile}`).href;
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== trustedURL) event.preventDefault();
    });
    window.webContents.session.setPermissionRequestHandler((_wc, _p, cb) =>
      cb(false),
    );
    controller = new BrowserController(
      window,
      content,
      store,
      engine,
      app.getPreferredSystemLanguages(),
      updateMenu,
    );
    ipcMain.handle('browser:command', async (event, raw: unknown) => {
      if (
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url !== trustedURL
      )
        throw Error('Unauthorized sender');
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw Error('Invalid command');
      const c = raw as Record<string, unknown>;
      if (
        Object.keys(c).some(
          (k) =>
            ![
              'action',
              'url',
              'id',
              'language',
              'zoom',
              'muted',
              'title',
              'folderId',
              'height',
              'x',
              'y',
              'image',
              'sourceKey',
              'order',
            ].includes(k),
        ) ||
        typeof c.action !== 'string' ||
        (c.image !== undefined &&
          (c.action !== 'saveFavicon' ||
            typeof c.image !== 'string' ||
            c.image.length > 32768)) ||
        (c.sourceKey !== undefined &&
          (c.action !== 'saveFavicon' ||
            typeof c.sourceKey !== 'string' ||
            c.sourceKey.length > 40000)) ||
        (['x', 'y'] as const).some(
          (key) =>
            c[key] !== undefined &&
            (c.action !== 'openBookmarkFolder' ||
              !Number.isSafeInteger(c[key]) ||
              Number(c[key]) < 0 ||
              Number(c[key]) > 10000),
        ) ||
        (c.height !== undefined &&
          (c.action !== 'setToolbarHeight' ||
            !Number.isInteger(c.height) ||
            Number(c.height) < 80 ||
            Number(c.height) > 240)) ||
        (c.title !== undefined &&
          (!['updateBookmark', 'createFolder', 'renameFolder'].includes(
            String(c.action),
          ) ||
            typeof c.title !== 'string' ||
            !c.title.trim() ||
            c.title.length > 200 ||
            Array.from(c.title).some(
              (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
            ))) ||
        (c.order !== undefined &&
          (!['updateBookmark', 'renameFolder'].includes(String(c.action)) ||
            !Number.isSafeInteger(c.order) ||
            Number(c.order) < 0 ||
            Number(c.order) > 50000)) ||
        (c.folderId !== undefined &&
          (c.action !== 'updateBookmark' ||
            (c.folderId !== null &&
              (!Number.isSafeInteger(c.folderId) ||
                Number(c.folderId) < 1)))) ||
        (c.zoom !== undefined &&
          (c.action !== 'setSitePreferences' ||
            !Number.isInteger(c.zoom) ||
            Number(c.zoom) < 50 ||
            Number(c.zoom) > 200)) ||
        (c.muted !== undefined &&
          (c.action !== 'setSitePreferences' ||
            typeof c.muted !== 'boolean')) ||
        (c.language !== undefined &&
          (c.action !== 'setLanguage' ||
            (c.language !== 'auto' && !isLanguage(c.language)))) ||
        (c.url !== undefined &&
          (typeof c.url !== 'string' || c.url.length > 8192)) ||
        (c.id !== undefined &&
          (!Number.isSafeInteger(c.id) || Number(c.id) < 1))
      )
        throw Error('Invalid arguments');
      return controller!.command(c as unknown as Command);
    });
    controller.restore();
    void startup.then(() => controller?.emit());
    if (uiURL) await window.loadURL(uiURL);
    else await window.loadFile(uiFile);
    function updateMenu() {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: t('browser'),
            submenu: [
              {
                label: t('newTab'),
                accelerator: 'CommandOrControl+T',
                click: () => void controller?.command({ action: 'new' }),
              },
              {
                label: t('closeTab'),
                accelerator: 'CommandOrControl+W',
                click: () => void controller?.command({ action: 'close' }),
              },
              {
                label: t('address'),
                accelerator: 'CommandOrControl+L',
                click: () => {
                  window.webContents.focus();
                  window.webContents.send('browser:focus-address');
                },
              },
              {
                label: t('reload'),
                accelerator: 'CommandOrControl+R',
                click: () => void controller?.command({ action: 'reload' }),
              },
              {
                label: t('back'),
                accelerator: 'Alt+Left',
                click: () => void controller?.command({ action: 'back' }),
              },
              {
                label: t('forward'),
                accelerator: 'Alt+Right',
                click: () => void controller?.command({ action: 'forward' }),
              },
              {
                label: t('settings'),
                accelerator: 'CommandOrControl+,',
                click: () =>
                  void controller?.command({ action: 'showSettings' }),
              },
              { type: 'separator' },
              { role: 'quit', label: t('quit') },
            ],
          },
          {
            label: t('edit'),
            submenu: [
              { role: 'undo', label: t('undo') },
              { role: 'redo', label: t('redo') },
              { type: 'separator' },
              { role: 'cut', label: t('cut') },
              { role: 'copy', label: t('copy') },
              { role: 'paste', label: t('paste') },
              { role: 'selectAll', label: t('selectAll') },
            ],
          },
        ]),
      );
    }
    updateMenu();
    window.setMenuBarVisibility(false);
    const timer = setInterval(() => controller?.emit(), 3000);
    window.on('closed', () => clearInterval(timer));
  })
  .catch((e) => {
    console.error(e);
    dialog.showErrorBox('Perun IPFS Browser', (e as Error).message);
    app.quit();
  });
