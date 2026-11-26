import { browserUI, launchBrowser } from './browser-ui';
import {
  starterBookmarks,
  starterFolders,
} from '../../src/shared/starter-bookmarks';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  rename,
  rmdir,
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { KuboEngine } from '../../src/main/ipfs/engine';
let app: ElectronApplication,
  ui: Page,
  dir: string,
  profile: string,
  cidA: string,
  cidB: string,
  peer: string;
let iconRequests: string[] = [];
let faviconOffline = false;
let postResponses = 0;
let finishSlowPage: (() => void) | undefined;
let server: ReturnType<typeof createServer>,
  https: ReturnType<typeof createHttpsServer>,
  base: string,
  secureBase: string;
async function start() {
  app = await launchBrowser({
    args: ['.'],
    env: {
      ...process.env,
      IPFS_BROWSER_PROFILE: profile,
      IPFS_BROWSER_OFFLINE: '1',
    },
  });
  ui = await browserUI(app);
  await ui.evaluate(() =>
    window.browser.command({ action: 'setLanguage', language: 'pl' }),
  );
  await expect(ui.locator('#node')).toHaveText('IPFS: Gotowy', {
    timeout: 40000,
  });
}
async function go(url: string) {
  await ui.locator('#address').fill(url);
  await ui
    .locator('#navigate')
    .evaluate((f: HTMLFormElement) => f.requestSubmit());
  await expect(ui.locator('#panel')).toBeHidden();
}
async function page(urlPart: string) {
  await expect
    .poll(
      async () =>
        await app.evaluate(
          ({ webContents }, part) =>
            webContents
              .getAllWebContents()
              .some((w) => w.getURL().includes(part)),
          urlPart,
        ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      app
        .context()
        .pages()
        .some((p) => p.url().includes(urlPart)),
    )
    .toBe(true);
  // Several tabs may show the same URL. Match the active WebContents by its CDP target.
  const active = await ui.evaluate(
    () =>
      new Promise<number>((resolve) => {
        window.browser.onState((state) => resolve(state.active));
        void window.browser.command({ action: 'state' });
      }),
  );
  const target = await app.evaluate(
    ({ webContents }, id) =>
      webContents.fromId(id)!.getOrCreateDevToolsTargetId(),
    active,
  );
  let selected: Page | undefined;
  await expect
    .poll(async () => {
      for (const candidate of app.context().pages()) {
        const cdp = await app.context().newCDPSession(candidate);
        const info = await cdp.send('Target.getTargetInfo');
        await cdp.detach();
        if (info.targetInfo.targetId === target) {
          selected = candidate;
          return true;
        }
      }
      return false;
    })
    .toBe(true);
  await selected!.waitForLoadState();
  return selected!;
}

test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'browser-e2e-'));
  profile = join(dir, 'profile');
  await mkdir(profile);
  const a = new KuboEngine(
    resolve('resources/kubo/ipfs'),
    join(profile, 'ipfs'),
    true,
  );
  await a.start();
  try {
    for (const [name, color] of [
      ['a', 'rgb(12, 34, 56)'],
      ['b', 'rgb(56, 34, 12)'],
    ]) {
      const fixture = join(dir, name);
      await mkdir(fixture);
      await writeFile(
        join(fixture, 'index.html'),
        `<!doctype html><link rel="stylesheet" href="style.css"><h1>${name}</h1><script src="app.js"></script><a href="next.html">Next</a>`,
      );
      await writeFile(join(fixture, 'style.css'), `h1{color:${color}}`);
      await writeFile(
        join(fixture, 'app.js'),
        `document.querySelector('h1').dataset.script='yes';`,
      );
      await writeFile(join(fixture, 'next.html'), '<h1>Next</h1>');
      const cid = await a.cli('add', '-Qr', fixture);
      if (name === 'a') cidA = cid;
      else cidB = cid;
    }
    peer = (await a.json<{ ID: string }>('id')).ID;
    await a.cli('name', 'publish', '--allow-offline', `/ipfs/${cidA}`);
  } finally {
    await a.stop();
  }
  const iconPNG = await readFile(resolve('resources/branding/site-ipfs.png'));
  const fallbackPNG = await readFile(
    resolve('resources/branding/site-web.png'),
  );
  const ico = Buffer.alloc(22);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(1, 4);
  ico[6] = 16;
  ico[7] = 16;
  ico.writeUInt16LE(1, 10);
  ico.writeUInt16LE(32, 12);
  ico.writeUInt32LE(fallbackPNG.length, 14);
  ico.writeUInt32LE(22, 18);
  server = createServer((req, res) => {
    if (req.url?.startsWith('/slow-page?')) {
      finishSlowPage = () => res.end('<h1>Slow page</h1>');
      return;
    }
    if (req.url?.startsWith('/slow-body?')) {
      // Headers and the first bytes arrive at once; the rest is held back.
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.write('<h1>Partial page</h1>' + ' '.repeat(2048));
      finishSlowPage = () => res.end('<p>Done</p>');
      return;
    }
    if (req.url === '/favicon.ico' || req.url?.startsWith('/icons/')) {
      iconRequests.push(req.url!);
      if (faviconOffline) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.url === '/favicon.ico') {
        res.setHeader('Content-Type', 'image/x-icon');
        res.end(Buffer.concat([ico, fallbackPNG]));
        return;
      }
      if (req.url === '/icons/linked.png') {
        res.setHeader('Content-Type', 'image/png');
        res.end(iconPNG);
        return;
      }
      if (req.url === '/icons/icon.svg') {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end(
          '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>',
        );
        return;
      }
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.url?.startsWith('/favicon-')) {
      res.setHeader('Content-Type', 'text/html');
      const link =
        req.url === '/favicon-linked'
          ? '<link rel="shortcut icon" href="/icons/linked.png">'
          : req.url === '/favicon-svg'
            ? '<link rel="icon" type="image/svg+xml" href="/icons/icon.svg">'
            : req.url === '/favicon-data'
              ? '<link rel="icon" href="data:image/svg+xml,' +
                encodeURIComponent(
                  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>',
                ) +
                '">'
              : '';
      res.end('<!doctype html>' + link + '<h1>Favicon fixture</h1>');
      return;
    }

    if (req.url === '/post-source') {
      // Every response is unique: refetching cannot reproduce the shown page.
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Cache-Control', 'no-store');
      res.end(
        req.method === 'POST'
          ? `<h1>Posted ${++postResponses}</h1>`
          : `<h1>Form ${++postResponses}</h1><form method="post"><button>Send</button></form>`,
      );
      return;
    }
    if (req.url === '/download') {
      res.setHeader('Content-Disposition', 'attachment; filename=fixture.txt');
      res.end('download fixture');
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(
      new URL(req.url || '/', 'http://fixture').pathname === '/second'
        ? '<h1>Second</h1>'
        : '<h1>First</h1><a href="/second">Second</a><a target="_blank" href="/popup">Popup</a><a href="/download">Download</a><form action="/second"><button>Submit</button></form>',
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'ignore' },
  );
  https = createHttpsServer(
    {
      key: await readFile(join(dir, 'key.pem')),
      cert: await readFile(join(dir, 'cert.pem')),
    },
    (_req, res) => res.end('<h1>Secure fixture</h1>'),
  );
  await new Promise<void>((r) => https.listen(0, '127.0.0.1', r));
  secureBase = `https://127.0.0.1:${(https.address() as { port: number }).port}`;
  await start();
});
test.afterAll(async () => {
  await app?.close();
  await new Promise<void>((r) => server?.close(() => r()));
  await new Promise<void>((r) => https?.close(() => r()));
  if (dir) await rm(dir, { recursive: true, force: true });
});
test('HTTP, navigation, forms, popup, tab switching, bookmark and persistent history', async () => {
  await go(base);
  let p = await page(base);
  await expect(p.locator('h1')).toHaveText('First');
  await expect(
    ui.evaluate(() =>
      window.browser.command({
        action: 'navigate',
        url: 'file://remote.invalid/path',
      }),
    ),
  ).rejects.toThrow();
  await expect(
    ui.evaluate(() => window.browser.command({ action: 'state', id: -1 })),
  ).rejects.toThrow();
  expect(
    await p.evaluate(() => ({
      node: typeof (window as unknown as { require?: unknown }).require,
      ipc: typeof window.browser,
    })),
  ).toEqual({ node: 'undefined', ipc: 'undefined' });
  const savePath = join(dir, 'downloaded.txt');
  await app.evaluate(({ dialog }, path) => {
    Object.assign(dialog, {
      showSaveDialog: async () => ({ canceled: false, filePath: path }),
    });
  }, savePath);
  await p.getByRole('link', { name: 'Download', exact: true }).click();
  await expect
    .poll(() => readFile(savePath, 'utf8').catch(() => ''))
    .toBe('download fixture');
  await p.getByRole('link', { name: 'Second', exact: true }).click();
  await expect(p.locator('h1')).toHaveText('Second');
  await ui.locator('#back').click();
  await expect(p.locator('h1')).toHaveText('First');
  await ui.locator('#forward').click();
  await expect(p.locator('h1')).toHaveText('Second');
  await ui.locator('#back').click();
  await p.getByRole('button', { name: 'Submit' }).click();
  await expect(p.locator('h1')).toHaveText('Second');
  await ui.locator('#bookmark').click();
  await go(base);
  await expect(p.locator('h1')).toHaveText('First');
  // Script popups without user input are blocked; a real click opens one tab.
  await p.evaluate(() => {
    for (let i = 0; i < 5; i++) window.open('/popup');
  });
  await p.getByRole('link', { name: 'Popup' }).click();
  await expect(ui.locator('.tab')).toHaveCount(2);
  await ui.locator('.tab').first().locator('button').first().click();
  await expect(ui.locator('#address')).toHaveValue(base + '/');
  await ui.locator('#home').click();
  await ui.locator('#library').click();
  await expect(ui.locator('#details')).toContainText(base + '/second');
  await app.close();
  await start();
  await ui.locator('#home').click();
  await ui.locator('#library').click();
  await expect(ui.locator('#details')).toContainText(base + '/second');
});
test('clears history, cookies and site storage after confirmation', async () => {
  await expect(ui.locator('#restart-node')).toBeHidden();
  await go(base + '/second');
  const p = await page(base + '/second');
  await p.evaluate(() => {
    document.cookie = 'fixture=1; max-age=3600';
    localStorage.setItem('fixture', '1');
  });
  const cookies = () =>
    app.evaluate(
      async ({ session }) =>
        (await session.fromPartition('persist:browsing').cookies.get({}))
          .length,
    );
  expect(await cookies()).toBeGreaterThan(0);
  await app.evaluate(({ dialog }) => {
    Object.assign(dialog, {
      showMessageBox: async () => ({ response: 1, checkboxChecked: false }),
    });
  });
  await ui.locator('#settings').click();
  await ui.locator('#clear-data').click();
  await expect(ui.locator('#clear-data-status')).toHaveText('');
  expect(await cookies()).toBeGreaterThan(0);
  await app.evaluate(({ dialog }) => {
    Object.assign(dialog, {
      showMessageBox: async () => ({ response: 0, checkboxChecked: false }),
    });
  });
  await ui.locator('#clear-data').click();
  await expect(ui.locator('#clear-data-status')).toHaveText(
    'Dane przeglądania wyczyszczone',
  );
  expect(await cookies()).toBe(0);
  const library = (await ui.evaluate(() =>
    window.browser.command({ action: 'library' }),
  )) as { history: unknown[] };
  expect(library.history).toEqual([]);
  await p.reload();
  expect(await p.evaluate(() => localStorage.getItem('fixture'))).toBeNull();
  await ui.locator('#settings-dialog [data-dismiss]').click();
});
test('copies the source of a POST result as shown, without a new request', async () => {
  // A cacheable GET page: the copy is the exact response, not a DOM dump.
  await go(base + '/second');
  const second = await page('/second');
  await expect(second.locator('h1')).toHaveText('Second');
  await ui.locator('#site-settings').click();
  await ui.locator('#site-copy-source').click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('<h1>Second</h1>');
  await ui.locator('#site-dialog [data-dismiss]').click();
  await go(base + '/post-source');
  const p = await page('/post-source');
  await p.getByRole('button', { name: 'Send' }).click();
  await expect(p.locator('h1')).toHaveText(/^Posted \d+$/);
  const shown = await p.locator('h1').textContent();
  const requests = postResponses;
  await ui.locator('#site-settings').click();
  await ui.locator('#site-copy-source').click();
  // The uncached POST result is not downloaded again (that would be a new,
  // different page); the copy contains the response that is on screen.
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toContain(`<h1>${shown}</h1>`);
  expect(postResponses).toBe(requests);
  await ui.locator('#site-dialog [data-dismiss]').click();
});

test('fills the address field as a progress bar until navigation completes or stops', async () => {
  const address = ui.locator('#address');
  for (const stop of [false, true]) {
    try {
      await go(base + '/slow-page?stop=' + stop);
      await expect.poll(() => Boolean(finishSlowPage)).toBe(true);
      await expect(address).toHaveClass(/\bloading\b/);
      await expect(address).toHaveAttribute('aria-busy', 'true');
      // Duration is unknown, so the fill repeats in six-second cycles.
      await expect(address).toHaveCSS('animation-duration', '6s');
      await expect(address).toHaveCSS('animation-iteration-count', 'infinite');
      if (stop) await ui.locator('#stop').click();
      else finishSlowPage?.();
      await expect(address).not.toHaveClass(/\bloading\b/);
      await expect(address).toHaveAttribute('aria-busy', 'false');
      await expect(ui.locator('#message')).toBeEmpty();
    } finally {
      finishSlowPage?.();
      finishSlowPage = undefined;
    }
  }
});

test('keeps the new-tab button after the last tab and folds bookmarks that do not fit', async () => {
  await go(base);
  const bar = ui.locator('#bookmarks-bar'),
    more = ui.locator('#bookmarks-overflow');
  const plusGap = () =>
    ui.evaluate(() => {
      const tabs = document.querySelectorAll('.tab');
      const last = tabs[tabs.length - 1].getBoundingClientRect();
      return (
        document.getElementById('new')!.getBoundingClientRect().left -
        last.right
      );
    });
  expect(await plusGap()).toBeGreaterThanOrEqual(0);
  expect(await plusGap()).toBeLessThan(16);
  await expect(bar).toHaveCSS('overflow-x', 'hidden');
  const resize = (width: number) =>
    app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0].setSize(width, 850),
      width,
    );
  await resize(800);
  try {
    await expect(more).toBeVisible();
    const hidden = await bar.evaluate((element) =>
      Array.from(
        element.querySelectorAll<HTMLElement>(
          ':scope > a[hidden], :scope > [data-folder-id][hidden]',
        ),
      ).map((entry) => entry.textContent!.replace(/^📁 /, '').trim()),
    );
    expect(hidden.length).toBeGreaterThan(0);
    // Nothing is cut off or scrolled: visible entries end before the » button.
    expect(
      await bar.evaluate((element) => {
        const limit = document
          .getElementById('bookmarks-overflow')!
          .getBoundingClientRect().left;
        return Array.from(
          element.querySelectorAll<HTMLElement>(
            ':scope > a:not([hidden]), :scope > [data-folder-id]:not([hidden])',
          ),
        ).every((entry) => entry.getBoundingClientRect().right <= limit);
      }),
    ).toBe(true);
    await app.evaluate(({ Menu }) => {
      const scope = globalThis as unknown as {
        overflowLabels?: string[];
        originalPopup?: typeof Menu.prototype.popup;
      };
      scope.originalPopup = Menu.prototype.popup;
      Menu.prototype.popup = function () {
        scope.overflowLabels = this.items.map((item) =>
          item.label.replace(/&&/g, '&'),
        );
      };
    });
    await more.click();
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as unknown as { overflowLabels?: string[] })
              .overflowLabels,
        ),
      )
      .toEqual(hidden);
    // A wider window shows more entries and folds fewer of them.
    await resize(1250);
    await expect
      .poll(() =>
        bar.evaluate(
          (element) =>
            element.querySelectorAll(
              ':scope > a[hidden], :scope > [data-folder-id][hidden]',
            ).length,
        ),
      )
      .toBeLessThan(hidden.length);
  } finally {
    await app.evaluate(({ Menu }) => {
      const scope = globalThis as unknown as {
        originalPopup?: typeof Menu.prototype.popup;
      };
      if (scope.originalPopup) Menu.prototype.popup = scope.originalPopup;
    });
    await resize(1250);
  }
});

test('keeps the next page free of errors after replacing a pending navigation', async () => {
  try {
    await go(base + '/slow-page?replace');
    await expect.poll(() => Boolean(finishSlowPage)).toBe(true);
    await go(base + '/second');
    const next = await page('/second');
    await expect(next.locator('h1')).toHaveText('Second');
    await expect(ui.locator('#message')).toBeEmpty();
  } finally {
    finishSlowPage?.();
    finishSlowPage = undefined;
  }
});

test('keeps a committed page uncovered while it is still loading', async () => {
  try {
    await go(base + '/slow-body?commit');
    await expect.poll(() => Boolean(finishSlowPage)).toBe(true);
    await expect(ui.locator('#address')).toHaveClass(/\bloading\b/);
    // Progress lives in the toolbar; no extra view may sit above the page.
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow, WebContentsView }) =>
          BrowserWindow.getAllWindows()[0]
            .contentView.children.filter(
              (view) => view instanceof WebContentsView && view.getVisible(),
            )
            .map((view) =>
              (
                view as InstanceType<typeof WebContentsView>
              ).webContents.getURL(),
            ),
        ),
      )
      .toEqual([base + '/slow-body?commit']);
    await expect(ui.locator('#stop')).toBeVisible();
  } finally {
    finishSlowPage?.();
    finishSlowPage = undefined;
  }
});

test('HTTPS certificate validation stays enabled; trusted local fixture loads', async () => {
  await go(secureBase);
  await expect(ui.locator('#message')).toContainText(
    'ERR_CERT_AUTHORITY_INVALID',
  );
  // Trust only this fixture certificate, only in the test harness. Production has no bypass.
  await app.evaluate(
    ({ app }, url) =>
      app.on(
        'certificate-error',
        (event, _wc, requestURL, _error, _cert, callback) => {
          if (requestURL.startsWith(url)) {
            event.preventDefault();
            callback(true);
          } else callback(false);
        },
      ),
    secureBase,
  );
  await ui.locator('#reload').click();
  const p = await page(secureBase);
  await expect(p.locator('h1')).toHaveText('Secure fixture');
});
test('IPFS HTML/CSS/JS, IPNS, shared storage, BroadcastChannel and no Node access', async () => {
  await go(`ipfs://${cidA}/`);
  let a = await page(`/ipfs/${cidA}/`);
  await expect(a.locator('h1')).toHaveAttribute('data-script', 'yes');
  await expect(a.locator('h1')).toHaveCSS('color', 'rgb(12, 34, 56)');
  expect(
    await a.evaluate(
      () => typeof (window as unknown as { require?: unknown }).require,
    ),
  ).toBe('undefined');
  await a.getByRole('link', { name: 'Next', exact: true }).click();
  await expect(a.locator('h1')).toHaveText('Next');
  await expect(ui.locator('#address')).toHaveValue(`ipfs://${cidA}/next.html`);
  await ui.locator('#back').click();
  await expect(a.locator('h1')).toHaveText('a');
  await ui.locator('#copy').click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    `ipfs://${cidA}/`,
  );
  await a.evaluate(async () => {
    localStorage.setItem('shared', 'from-a');
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('shared-db', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('data');
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const db = r.result;
        const t = db.transaction('data', 'readwrite');
        t.objectStore('data').put('from-a', 'key');
        t.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
  });
  await ui.locator('#new').click();
  await go(`ipfs://${cidB}/`);
  const b = await page(`/ipfs/${cidB}/`);
  await expect(b.locator('h1')).toHaveText('b');
  expect(await b.evaluate(() => localStorage.getItem('shared'))).toBe('from-a');
  expect(
    await b.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const r = indexedDB.open('shared-db', 1);
          r.onerror = () => reject(r.error);
          r.onsuccess = () => {
            const db = r.result;
            const get = db.transaction('data').objectStore('data').get('key');
            get.onsuccess = () => {
              db.close();
              resolve(get.result);
            };
          };
        }),
    ),
  ).toBe('from-a');
  await a.evaluate(() => {
    const c = new BroadcastChannel('shared-channel');
    c.onmessage = (e) => localStorage.setItem('broadcast', e.data);
  });
  await b.evaluate(() => {
    const c = new BroadcastChannel('shared-channel');
    c.postMessage('received');
    c.close();
  });
  await expect
    .poll(() => a.evaluate(() => localStorage.getItem('broadcast')))
    .toBe('received');
  expect(
    await b.evaluate(
      () =>
        navigator.serviceWorker?.register('/worker.js').then(
          () => false,
          () => true,
        ) ?? true,
    ),
  ).toBe(true);
  await go(`ipns://${peer}/`);
  const ipns = await page(`/ipns/${peer}/`);
  await expect(ipns.locator('h1')).toHaveText('a');
  await expect(ui.locator('#address')).toHaveValue(`ipns://${peer}/`);
  await ui.locator('#site-settings').click();
  // Fixtures were already pinned on import: remove and re-add through page settings.
  await expect(ui.locator('#unpin')).toBeEnabled();
  await ui.locator('#unpin').click();
  await expect(ui.locator('#pin')).toBeEnabled();
  await ui.locator('#pin').click();
  await expect(ui.locator('#unpin')).toBeEnabled();
  await ui.evaluate(() => window.browser.command({ action: 'dismissOverlay' }));
  await ui.locator('#home').click();
  await ui.locator('#stats').click();
  await expect(ui.locator('#details')).toContainText(cidA);
  const stats = (await ui.evaluate(() =>
    window.browser.command({ action: 'stats' }),
  )) as { manualPins: string[] };
  expect(stats.manualPins).toContain(cidA);
  await ui.locator('#site-settings').click();
  await expect(ui.locator('#unpin')).toBeEnabled();
  await ui.locator('#unpin').click();
  await expect
    .poll(
      async () =>
        (
          (await ui.evaluate(() =>
            window.browser.command({ action: 'stats' }),
          )) as { manualPins: string[] }
        ).manualPins,
    )
    .not.toContain(cidA);
  await ui.evaluate(() => window.browser.command({ action: 'dismissOverlay' }));
  await go(base);
  const http = await page(base);
  expect(await http.evaluate(() => localStorage.getItem('shared'))).toBeNull();
  await http.evaluate((cid) => {
    const link = document.createElement('a');
    link.href = `ipfs://${cid}/`;
    link.textContent = 'IPFS fixture';
    document.body.append(link);
  }, cidA);
  await http.getByRole('link', { name: 'IPFS fixture' }).click();
  await expect(http).toHaveURL(`p2p://shared/ipfs/${cidA}/`);
  await expect(ui.locator('#address')).toHaveValue(`ipfs://${cidA}/`);
});

test('imports selected files and a directory, copies and opens the CID, handles cancellation and persists pins', async () => {
  const note = join(dir, 'przeczytaj.txt');
  await writeFile(note, 'Imported note');
  const file = join(dir, 'index.html');
  await writeFile(file, '<h1>Imported through browser</h1>');
  await ui.locator('#home').click();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [path, path.replace(/index\.html$/, 'przeczytaj.txt')],
    })) as typeof dialog.showOpenDialog;
  }, file);
  const bookmarks = join(profile, 'bookmarks.json');
  await rename(bookmarks, bookmarks + '.backup');
  await mkdir(bookmarks);
  let url: string;
  try {
    await ui.locator('#importFiles').click();
    await expect(ui.locator('#importResult')).toContainText(
      'Błąd zapisu lokalnego',
    );
    url = (await ui.locator('#importResult code').textContent())!;
    expect(url).toMatch(/^ipfs:\/\/b[a-z0-9]+\/$/);
    await ui
      .getByRole('button', { name: 'Kopiuj adres IPFS', exact: true })
      .click();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      url,
    );
  } finally {
    await rmdir(bookmarks);
    await rename(bookmarks + '.backup', bookmarks);
  }
  // Saving the local record must succeed even after the source file disappears.
  await rm(note);
  await ui
    .locator('#importResult')
    .getByRole('button', { name: 'Zapisz', exact: true })
    .click();
  await expect(ui.locator('#importResult')).not.toContainText(
    'Błąd zapisu lokalnego',
  );
  await expect(ui.locator('#importResult code')).toHaveText(url);
  const favorites = (await ui.evaluate(async () => ({
    folders: await window.browser.command({ action: 'bookmarkFolders' }),
    bookmarks: await window.browser.command({ action: 'bookmarks' }),
  }))) as {
    folders: { id: number; title: string }[];
    bookmarks: { url: string; title: string; folderId: number | null }[];
  };
  const importedBookmark = favorites.bookmarks.find((b) => b.url === url)!;
  expect(importedBookmark.title).toContain('index.html');
  expect(importedBookmark.folderId).toBe(
    favorites.folders.find((f) => f.title === 'myIPFS')?.id,
  );

  await ui
    .getByRole('button', { name: 'Kopiuj adres IPFS', exact: true })
    .click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(url);
  await ui
    .getByRole('button', {
      name: 'Kopiuj adres pliku: przeczytaj.txt',
      exact: true,
    })
    .click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    url + 'przeczytaj.txt',
  );
  await ui
    .getByRole('button', { name: 'Otwórz w nowej karcie', exact: true })
    .click();
  const importedPage = await page(url.replace('ipfs://', '/ipfs/'));
  await expect(importedPage.locator('h1')).toHaveText(
    'Imported through browser',
  );
  expect(await importedPage.evaluate(() => typeof window.browser)).toBe(
    'undefined',
  );
  await ui.locator('#home').click();
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = (async () => ({
      canceled: true,
      filePaths: [],
    })) as typeof dialog.showOpenDialog;
  });
  await ui.locator('#importFiles').click();
  await expect(ui.locator('#importResult')).toContainText('Anulowano');
  await app.evaluate(
    ({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [path],
      })) as typeof dialog.showOpenDialog;
    },
    join(dir, 'missing-file'),
  );
  await ui.locator('#importFiles').click();
  await expect(ui.locator('#importResult')).toContainText('Nie udało się');
  await expect(ui.locator('#importFiles')).toBeEnabled();
  await app.evaluate(
    ({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [path],
      })) as typeof dialog.showOpenDialog;
    },
    join(dir, 'a'),
  );
  await ui.locator('#importDirectory').click();
  await expect(ui.locator('#importResult')).toContainText('Dodano i przypięto');
  await ui
    .getByRole('button', { name: 'Otwórz w nowej karcie', exact: true })
    .click();
  const directoryURL = (await ui.locator('#importResult code').textContent())!;
  const p = await page(directoryURL.replace('ipfs://', '/ipfs/'));
  await expect(p.locator('h1')).toHaveText('a');
  await app.close();
  await start();
  await ui.locator('#home').click();
  await ui.locator('#library').click();
  await expect(ui.locator('#details')).toContainText(url);
  const stats = (await ui.evaluate(() =>
    window.browser.command({ action: 'stats' }),
  )) as { manualPins: string[]; pins: string[] };
  expect(stats.manualPins).toContain(url.split('/')[2]);
  expect(stats.pins).toContain(url.split('/')[2]);
});

test('settings gear, scoped page controls and an imported text-file directory work and persist', async () => {
  await ui.locator('#settings').click();
  await expect(ui.locator('#settings-dialog')).toBeVisible();
  await ui.locator('#language').selectOption('ja');
  await expect(ui.locator('html')).toHaveAttribute('lang', 'ja');
  await ui.locator('#language').selectOption('ko');
  await expect(ui.locator('html')).toHaveAttribute('lang', 'ko');
  await ui.locator('#language').selectOption('pl');
  await ui.locator('#restore').uncheck();
  await ui.locator('#restore').check();
  await ui.locator('#settings-dialog [data-dismiss]').click();
  await expect(ui.locator('#settings-dialog')).not.toBeVisible();
  const file = join(dir, 'ipfs_links.txt');
  await writeFile(file, 'Directory regression fixture');
  await ui.locator('#home').click();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [path],
    })) as typeof dialog.showOpenDialog;
  }, file);
  await ui.locator('#importFiles').click();
  await expect(ui.locator('#importResult')).toContainText('Dodano i przypięto');
  const root = (await ui.locator('#importResult code').textContent())!;
  await ui
    .getByRole('button', { name: 'Otwórz w nowej karcie', exact: true })
    .click();
  let p = await page(root.replace('ipfs://', '/ipfs/'));
  await expect(
    p.getByRole('link', { name: 'ipfs_links.txt', exact: true }),
  ).toBeVisible();
  expect(await p.evaluate(() => typeof window.browser)).toBe('undefined');
  await p.getByRole('link', { name: 'ipfs_links.txt', exact: true }).click();
  await expect(p.locator('body')).toContainText('Directory regression fixture');
  await ui.locator('#site-settings').click();
  await expect(ui.locator('#site-dialog')).toBeVisible();
  await expect(ui.locator('#site-url')).toHaveText(root + 'ipfs_links.txt');
  await expect(ui.locator('#unpin')).toBeEnabled();
  await ui.locator('#unpin').click();
  await expect(ui.locator('#pin')).toBeEnabled();
  await ui.locator('#pin').click();
  await expect(ui.locator('#unpin')).toBeEnabled();
  await ui.locator('#site-zoom').selectOption('150');
  await expect(ui.locator('#site-zoom')).toBeEnabled();
  await ui.locator('#site-muted').check();
  await expect(ui.locator('#site-muted')).toBeEnabled();
  await ui.locator('#site-copy').click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe(root + 'ipfs_links.txt');
  await ui.locator('#site-dialog [data-dismiss]').click();
  expect(
    await app.evaluate(({ webContents }, part) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().includes(part))!;
      return {
        zoom: wc.getZoomFactor(),
        muted: wc.isAudioMuted(),
        mode: wc.getZoomMode(),
      };
    }, root.split('/')[2]),
  ).toEqual({ zoom: 1.5, muted: true, mode: 'isolated' });
  await ui.locator('#new').click();
  await go(base);
  await page(base);
  expect(
    await app.evaluate(
      ({ webContents }, url) =>
        webContents
          .getAllWebContents()
          .find((w) => w.getURL().startsWith(url))!
          .getZoomFactor(),
      base,
    ),
  ).toBe(1);
  await ui.locator('#site-settings').click();
  await expect(ui.locator('#site-zoom')).toBeEnabled();
  await expect(ui.locator('#site-ipfs')).toBeHidden();
  await expect(ui.locator('#site-muted')).not.toBeChecked();
  await expect(
    ui.evaluate(() =>
      window.browser.command({
        action: 'setSitePreferences',
        id: 1,
        url: 'https://wrong.invalid',
        zoom: 150,
      }),
    ),
  ).rejects.toThrow();
  await expect(
    ui.evaluate(() =>
      window.browser.command({ action: 'setSitePreferences', zoom: 9999 }),
    ),
  ).rejects.toThrow();
  await expect(
    ui.evaluate(() =>
      window.browser.command({
        action: 'setSitePreferences',
        muted: 'yes' as unknown as boolean,
      }),
    ),
  ).rejects.toThrow();
  await ui.locator('#site-dialog [data-dismiss]').click();
  await app.close();
  await start();
  await go(root);
  p = await page(root.replace('ipfs://', '/ipfs/'));
  await expect(
    p.getByRole('link', { name: 'ipfs_links.txt', exact: true }),
  ).toBeVisible();
  await ui.locator('#site-settings').click();
  await expect(ui.locator('#site-zoom')).toBeEnabled();
  await expect(ui.locator('#site-zoom')).toHaveValue('150');
  await expect(ui.locator('#site-muted')).toBeChecked();
  await ui.locator('#site-reset').click();
  await expect(ui.locator('#site-zoom')).toBeEnabled();
  await expect(ui.locator('#site-zoom')).toHaveValue('100');
  await expect(ui.locator('#site-muted')).not.toBeChecked();
  await ui.locator('#site-dialog [data-dismiss]').click();
});

test('previews original link URLs in the native title and displays starter bookmarks', async () => {
  const title = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getTitle(),
    );
  await ui.locator('#home').click();
  const reuters = ui.locator(
    '#start-bookmarks-links a[href="https://www.reuters.com/"]',
  );
  await expect(reuters).toBeVisible();
  await reuters.hover();
  await expect.poll(title).toBe('https://www.reuters.com/');
  await ui.locator('#address').hover();
  await expect.poll(title).toBe('Perun IPFS Browser');
  await go(base);
  const http = await page(base);
  await http.getByRole('link', { name: 'Second', exact: true }).hover();
  await expect.poll(title).toBe(base + '/second');
  await http.locator('h1').hover();
  await expect.poll(title).toBe('Perun IPFS Browser');
  await go(`ipfs://${cidA}/`);
  const ipfs = await page(`/ipfs/${cidA}/`);
  await ipfs.getByRole('link', { name: 'Next', exact: true }).hover();
  await expect.poll(title).toBe(`ipfs://${cidA}/next.html`);
  await ui.locator('#home').click();
  await expect.poll(title).toBe('Perun IPFS Browser');
  await go(`ipns://${peer}/`);
  const ipns = await page(`/ipns/${peer}/`);
  await ipns.getByRole('link', { name: 'Next', exact: true }).hover();
  await expect.poll(title).toBe(`ipns://${peer}/next.html`);
  await ui.locator('#settings').click();
  await expect.poll(title).toBe('Perun IPFS Browser');
  await ui.locator('#settings-dialog [data-dismiss]').click();
});

test('remembers the start page per tab when switching and closing tabs', async () => {
  await ui.locator('#new').click();
  await expect(ui.locator('#panel')).toBeVisible();
  const homeIndex = (await ui.locator('.tab').count()) - 1;
  await ui.locator('#new').click();
  await go(base);
  await page(base);
  await ui.locator('.tab').nth(homeIndex).locator('button').first().click();
  await expect(ui.locator('#panel')).toBeVisible();
  await expect(ui.locator('#start-bookmarks')).toBeVisible();
  await ui.locator('.tab').last().locator('button').first().click();
  await expect(ui.locator('#panel')).toBeHidden();
  await ui.locator('#home').click();
  await ui.locator('.tab').nth(homeIndex).locator('button').first().click();
  await ui.locator('.tab').last().locator('button').first().click();
  await expect(ui.locator('#panel')).toBeVisible();
  await ui.locator('#settings').click();
  await ui.locator('#settings-dialog [data-dismiss]').click();
  await expect(ui.locator('#panel')).toBeVisible();
  await ui.evaluate(() => window.browser.command({ action: 'close' }));
  await expect(ui.locator('#panel')).toBeVisible();
});

test('bookmark star updates the persistent bookmarks bar, opens favorites and reflects removal', async () => {
  const url = base + '/favorite?source=star';
  await go(url);
  let p = await page('/favorite?source=star');
  await expect(p.locator('h1')).toHaveText('First');
  await expect(ui.locator('#bookmarks-bar')).toBeVisible();
  await expect(
    ui.locator('#bookmarks-bar a[href="https://duckduckgo.com/"]'),
  ).toBeVisible();
  await expect(ui.locator('#bookmark')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await ui.locator('#bookmark').click();
  let saved = ui.locator(`#bookmarks-bar a[href="${url}"]`);
  await expect(saved).toHaveCount(1);
  await expect(ui.locator('#bookmark')).toHaveText('★');
  await expect(ui.locator('#bookmark')).toHaveAttribute('aria-pressed', 'true');
  await ui.locator('#bookmark').click();
  await expect(saved).toHaveCount(1);
  await go(base + '/second');
  await page('/second');
  await saved.hover();
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getTitle(),
      ),
    )
    .toBe(url);
  await saved.click();
  p = await page('/favorite?source=star');
  await expect(p.locator('h1')).toHaveText('First');
  await expect(ui.locator('#panel')).toBeHidden();
  await app.close();
  await start();
  saved = ui.locator(`#bookmarks-bar a[href="${url}"]`);
  await expect(saved).toHaveCount(1);
  await expect(ui.locator('#bookmark')).toHaveAttribute('aria-pressed', 'true');
  await ui.locator('#home').click();
  await ui.locator('#library').click();
  const row = ui
    .locator('#details p')
    .filter({ has: ui.locator('small').filter({ hasText: url }) });
  await row.getByRole('button', { name: 'Usuń', exact: true }).click();
  await expect(saved).toHaveCount(0);
  await expect(ui.locator('#bookmark')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await app.close();
  await start();
  saved = ui.locator(`#bookmarks-bar a[href="${url}"]`);
  await expect(saved).toHaveCount(0);
});

test('edits, groups and deletes bookmarks and folders without an empty toolbar band', async () => {
  const url = base + '/organized';
  await go(url);
  await page('/organized');
  await ui.locator('#bookmark').click();
  let entry = ui.locator(`#bookmarks-bar a[href="${url}"]`);
  await expect(entry).toHaveCount(1);
  await entry.click({ button: 'right' });
  await expect(ui.locator('#bookmarks-dialog')).toBeVisible();
  await ui.locator('#new-folder-title').fill('Research');
  await ui.locator('#bookmark-new-folder button').click();
  let row = ui
    .locator('#bookmark-manager-list form')
    .filter({ has: ui.locator(`a[href="${url}"]`) });
  await row
    .locator('input:not(.bookmark-position)')
    .fill('My resource <notes>');
  const folderId = await row
    .locator('select option')
    .filter({ hasText: 'Research' })
    .getAttribute('value');
  await row.locator('select').selectOption(folderId!);
  await row.getByRole('button', { name: 'Zapisz', exact: true }).click();
  await expect(row.locator('a')).toHaveText('My resource <notes>');
  await ui.locator('#bookmarks-dialog [data-dismiss]').click();
  await expect(entry).toHaveCount(0);
  await ui.locator('#manage-bookmarks').click();
  await ui.locator('#bookmark-folder-filter').selectOption(folderId!);
  await expect(ui.locator('#bookmark-folder-filter')).toHaveValue(folderId!);
  await ui.locator('#folder-title').fill('Reading');
  await ui.locator('#bookmark-folder-edit button').first().click();
  await ui.locator('#bookmarks-dialog').press('Escape');
  await expect(ui.locator('#bookmarks-dialog')).not.toBeVisible();
  await ui.locator('#bookmark').click(); // Re-saving must preserve the user's name and folder.
  await app.close();
  await start();
  await expect(
    ui.locator(`#bookmarks-bar button[data-folder-id="${folderId}"]`),
  ).toHaveText('📁 Reading');
  await expect(ui.locator(`#bookmarks-bar a[href="${url}"]`)).toHaveCount(0);
  await ui.locator('#manage-bookmarks').click();
  await ui.locator('#bookmark-folder-filter').selectOption(folderId!);
  row = ui
    .locator('#bookmark-manager-list form')
    .filter({ has: ui.locator(`a[href="${url}"]`) });
  await expect(row.locator('a')).toHaveText('My resource <notes>');
  await ui.locator('#remove-folder').click();
  await ui.locator('#bookmarks-dialog [data-dismiss]').click();
  entry = ui.locator(`#bookmarks-bar a[href="${url}"]`);
  await expect(entry).toHaveText('My resource <notes>');
  await expect(
    ui.locator(`#bookmarks-bar button[data-folder-id="${folderId}"]`),
  ).toHaveCount(0);
  await entry.click({ button: 'right' });
  row = ui
    .locator('#bookmark-manager-list form')
    .filter({ has: ui.locator(`a[href="${url}"]`) });
  await row.getByRole('button', { name: 'Usuń', exact: true }).click();
  await expect(row).toHaveCount(0);
  await ui.locator('#bookmarks-dialog [data-dismiss]').click();
  await expect(entry).toHaveCount(0);
  await expect(
    ui.evaluate(() =>
      window.browser.command({ action: 'createFolder', title: '\u0000' }),
    ),
  ).rejects.toThrow();
  await expect(
    ui.evaluate(() =>
      window.browser.command({ action: 'setToolbarHeight', height: 9999 }),
    ),
  ).rejects.toThrow();
  const header = await ui.locator('header').boundingBox();
  const active = await ui.evaluate(
    () =>
      new Promise<number>((resolve) => {
        window.browser.onState((s) => resolve(s.active));
        void window.browser.command({ action: 'state' });
      }),
  );
  const bounds = await app.evaluate(
    ({ BrowserWindow }, id) =>
      BrowserWindow.getAllWindows()[0]
        .contentView.children.find(
          (view) =>
            'webContents' in view &&
            (view as Electron.WebContentsView).webContents.id === id,
        )!
        .getBounds(),
    active,
  );
  expect(bounds.y).toBe(Math.ceil(header!.y + header!.height));
  expect(header!.height).toBeLessThan(148);
});

test('stores favorites in JSON and recreates defaults after the file is deleted', async () => {
  const file = join(profile, 'bookmarks.json');
  const url = base + '/json-favorite';
  await go(url);
  await page('/json-favorite');
  await ui.locator('#bookmark').click();
  await expect
    .poll(async () =>
      JSON.parse(await readFile(file, 'utf8')).bookmarks.some(
        (b: { url: string }) => b.url === url,
      ),
    )
    .toBe(true);
  await app.close();
  await rm(file);
  await start();
  await expect(ui.locator('#bookmarks-bar a')).toHaveCount(2);
  await expect(
    ui.locator('#bookmarks-bar').locator('a, button[data-folder-id]'),
  ).toHaveText([
    'DuckDuckGo',
    'Mojeek',
    ...starterFolders.slice(0, 2).map((folder) => '📁 ' + folder.title),
    ...starterFolders
      .slice(2)
      .map((folder) => '📁 ' + folder.title)
      .sort(),
  ]);
  expect(starterFolders.slice(0, 2).map((folder) => folder.title)).toEqual([
    'Search',
    'Community',
  ]);
  await expect(
    ui.locator('#bookmarks-bar a[href="https://duckduckgo.com/"]'),
  ).toHaveCount(1);
  await expect(ui.locator(`#bookmarks-bar a[href="${url}"]`)).toHaveCount(0);
  const document = JSON.parse(await readFile(file, 'utf8'));
  expect(document.version).toBe(1);
  expect(document.bookmarks).toHaveLength(starterBookmarks.length);
  expect(document.bookmarks).toEqual(
    expect.arrayContaining(
      starterBookmarks.map((bookmark) =>
        expect.objectContaining({ ...bookmark }),
      ),
    ),
  );
  expect(document.folders).toEqual(starterFolders);
});

function nativeMenuKeys(symbols: number[], control = false) {
  // CDP keyboard input cannot reach an OS popup. Send real X11 events inside Xvfb.
  execFileSync('python3', [
    '-c',
    `
import ctypes, json, sys, time
x = ctypes.CDLL('libX11.so.6'); xt = ctypes.CDLL('libXtst.so.6')
x.XOpenDisplay.argtypes=[ctypes.c_char_p]; x.XOpenDisplay.restype=ctypes.c_void_p
x.XKeysymToKeycode.argtypes=[ctypes.c_void_p,ctypes.c_ulong]; x.XKeysymToKeycode.restype=ctypes.c_uint
x.XFlush.argtypes=[ctypes.c_void_p]; x.XCloseDisplay.argtypes=[ctypes.c_void_p]
xt.XTestFakeKeyEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
d=x.XOpenDisplay(None); assert d, 'X11 display required'
def key(symbol, down):
 xt.XTestFakeKeyEvent(d,x.XKeysymToKeycode(d,symbol),down,0); x.XFlush(d); time.sleep(.08)
for symbol in json.loads(sys.argv[1]):
 ctrl = sys.argv[2]=='1' and symbol==0xff0d
 if ctrl: key(0xffe3,1)
 key(symbol,1); key(symbol,0)
 if ctrl: key(0xffe3,0)
x.XCloseDisplay(d)
`,
    JSON.stringify(symbols),
    control ? '1' : '0',
  ]);
}

test('folder menus list bookmarks, navigate with native keyboard input and keep management separate', async () => {
  // New folders go last; keep them on the bar instead of in the » overflow menu.
  const resize = (width: number) =>
    app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0].setSize(width, 850),
      width,
    );
  await resize(2400);
  try {
    const first = base + '/folder-first',
      second = base + '/folder-second';
    for (const url of [second, first]) {
      await go(url);
      await page(url);
      await ui.locator('#bookmark').click();
    }
    await ui.locator('#manage-bookmarks').click();
    await ui.locator('#new-folder-title').fill('Quick links');
    await ui.locator('#bookmark-new-folder button').click();
    const id = await ui
      .locator('#bookmark-folder-filter option')
      .filter({ hasText: 'Quick links' })
      .getAttribute('value');
    for (const [url, title] of [
      // Each bookmark moved into a folder goes first, so move B before A.
      [second, 'B second'],
      [first, 'A first'],
    ]) {
      const row = ui
        .locator('#bookmark-manager-list form')
        .filter({ has: ui.locator(`a[href="${url}"]`) });
      await row.locator('input:not(.bookmark-position)').fill(title);
      await row.locator('select').selectOption(id!);
      await row.getByRole('button', { name: 'Zapisz', exact: true }).click();
      await expect(row.locator('a')).toHaveText(title);
    }
    await ui.locator('#new-folder-title').fill('Empty');
    await ui.locator('#bookmark-new-folder button').click();
    const empty = await ui
      .locator('#bookmark-folder-filter option')
      .filter({ hasText: 'Empty' })
      .getAttribute('value');
    await ui.locator('#bookmarks-dialog [data-dismiss]').click();
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const original = Menu.prototype.popup;
      Menu.prototype.popup = function (options) {
        const state = globalThis as unknown as {
          folderMenu: Electron.Menu;
          menuClosed: boolean;
        };
        state.folderMenu = this;
        state.menuClosed = false;
        this.once('menu-will-close', () => {
          state.menuClosed = true;
        });
        original.call(this, options);
      };
      BrowserWindow.getAllWindows()[0].focus();
    });
    const folder = ui.locator(`#bookmarks-bar button[data-folder-id="${id}"]`);
    const items = () =>
      app.evaluate(() =>
        (
          globalThis as unknown as { folderMenu: Electron.Menu }
        ).folderMenu?.items.map((item) => ({
          label: item.label,
          enabled: item.enabled,
        })),
      );
    const closed = () =>
      app.evaluate(
        () => (globalThis as unknown as { menuClosed: boolean }).menuClosed,
      );
    await go(second);
    await page(second);
    await folder.click();
    await expect
      .poll(() =>
        app.evaluate(() =>
          (
            globalThis as unknown as { folderMenu: Electron.Menu }
          ).folderMenu?.items.every(
            (item) =>
              item.icon &&
              typeof item.icon !== 'string' &&
              !item.icon.isEmpty(),
          ),
        ),
      )
      .toBe(true);
    await expect.poll(items).toEqual([
      { label: 'A first', enabled: true },
      { label: 'B second', enabled: true },
    ]);
    await expect(ui.locator('#bookmarks-dialog')).not.toBeVisible();
    await expect(ui.locator('#address')).toHaveValue(second);
    nativeMenuKeys([0xff54, 0xff0d]);
    await expect(ui.locator('#address')).toHaveValue(first);
    await page(first);
    await expect.poll(closed).toBe(true);
    const count = await ui.locator('.tab').count();
    await folder.focus();
    await ui.keyboard.press('ArrowDown');
    await expect.poll(closed).toBe(false);
    nativeMenuKeys([0xff54, 0xff0d], true);
    await expect(ui.locator('.tab')).toHaveCount(count + 1);
    await expect(ui.locator('#address')).toHaveValue(first);
    await page(first);
    await ui
      .locator(`#bookmarks-bar button[data-folder-id="${empty}"]`)
      .click();
    await expect
      .poll(items)
      .toEqual([{ label: 'Ten katalog jest pusty.', enabled: false }]);
    nativeMenuKeys([0xff1b]);
    await expect.poll(closed).toBe(true);
    await expect(ui.locator('#address')).toHaveValue(first);
    await expect(ui.locator('#bookmarks-dialog')).not.toBeVisible();
    await expect(
      ui.evaluate(() =>
        window.browser.command({
          action: 'openBookmarkFolder',
          id: 999999,
          x: 0,
          y: 0,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      ui.evaluate(() =>
        window.browser.command({
          action: 'openBookmarkFolder',
          id: Number(id),
          x: -1,
          y: 0,
        }),
      ),
    ).rejects.toThrow();
    await ui.locator('#manage-bookmarks').click();
    await expect(ui.locator('#bookmarks-dialog')).toBeVisible();
    await ui.locator('#bookmarks-dialog [data-dismiss]').click();
  } finally {
    await resize(1250);
  }
});

test('shows ICO, declared PNG and SVG favicons, persists normalized icons and uses a shared IPFS/IPNS default', async () => {
  const active = ui.locator('.tab.active .site-icon');
  await go(base + '/favicon-background');
  await page('/favicon-background');
  await ui.locator('#new').click();
  await go(base + '/favicon-fallback');
  await page('/favicon-fallback');
  await expect(active).toHaveAttribute('data-favicon', 'true');
  const fallback = await active.getAttribute('src');
  await go(base + '/favicon-linked');
  await page('/favicon-linked');
  await expect
    .poll(() => iconRequests.includes('/icons/linked.png'))
    .toBe(true);
  await expect(active).toHaveAttribute('data-favicon', 'true');
  await expect.poll(() => active.getAttribute('src')).not.toBe(fallback);
  const linked = await active.getAttribute('src');
  await ui.locator('#bookmark').click();
  await expect(
    ui.locator(`#bookmarks-bar a[href="${base}/favicon-linked"] img`),
  ).toHaveAttribute('data-favicon', 'true');
  await go(base + '/favicon-svg');
  await page('/favicon-svg');
  await expect.poll(() => iconRequests.includes('/icons/icon.svg')).toBe(true);
  await expect.poll(() => active.getAttribute('src')).not.toBe(linked);
  await expect(active).toHaveAttribute('data-favicon', 'true');
  const svg = await active.getAttribute('src');
  expect(svg).toMatch(/^data:image\/png;base64,/);
  await go(base + '/favicon-data');
  await page('/favicon-data');
  await expect
    .poll(() =>
      active.evaluate((image: HTMLImageElement) => {
        if (!image.complete || !image.naturalWidth) return [];
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const c = canvas.getContext('2d')!;
        c.drawImage(image, 0, 0);
        return Array.from(c.getImageData(8, 8, 1, 1).data);
      }),
    )
    .toEqual([0, 0, 255, 255]);
  await expect(active).toHaveAttribute('data-favicon', 'true');
  const persisted = await active.getAttribute('src');
  await ui.locator('#bookmark').click();
  await app.close();
  faviconOffline = true;
  await start();
  await expect
    .poll(
      async () =>
        (
          (await ui.evaluate(
            (url) => window.browser.command({ action: 'getFavicon', url }),
            base + '/favicon-data',
          )) as { cached: boolean }
        ).cached,
    )
    .toBe(true);
  const cached = (await ui.evaluate(
    (url) => window.browser.command({ action: 'getFavicon', url }),
    base + '/favicon-data',
  )) as { cached: boolean; images: string[] };
  expect(cached.cached).toBe(true);
  expect(cached.images[0]).toBe(persisted);
  // Restoration is lazy: only the selected tab gets a WebContents at startup.
  // Reopen the background fixture, then return to the restored tab, so the
  // background notification below comes from a live, unselected tab.
  const restored = await ui.evaluate(
    () =>
      new Promise<number>((resolve) => {
        window.browser.onState((state) => resolve(state.active));
        void window.browser.command({ action: 'state' });
      }),
  );
  await ui.evaluate(
    (url) => window.browser.command({ action: 'new', url }),
    base + '/favicon-background',
  );
  await page('/favicon-background');
  await ui.evaluate(
    (id) => window.browser.command({ action: 'switch', id }),
    restored,
  );
  await expect
    .poll(() =>
      app.evaluate(
        ({ webContents }, url) =>
          webContents
            .getAllWebContents()
            .some((wc) => wc.getURL() === url + '/favicon-background'),
        base,
      ),
    )
    .toBe(true);
  await app.evaluate(({ webContents }, url) => {
    const background = webContents
      .getAllWebContents()
      .find((wc) => wc.getURL() === url + '/favicon-background');
    if (!background) throw Error('Missing background fixture');
    background.emit('page-favicon-updated', {}, [url + '/favicon.ico']);
  }, base);
  const unchanged = (await ui.evaluate(
    (url) => window.browser.command({ action: 'getFavicon', url }),
    base + '/favicon-data',
  )) as { cached: boolean; images: string[] };
  expect(unchanged.cached).toBe(true);
  expect(unchanged.images[0]).toBe(persisted);
  await expect(
    ui.locator(`#bookmarks-bar a[href="${base}/favicon-data"] img`),
  ).toHaveAttribute('data-favicon', 'true');
  faviconOffline = false;
  await go(`ipfs://${cidA}/`);
  await page(`/ipfs/${cidA}/`);
  await expect(ui.locator('.tab.active img')).toHaveAttribute(
    'data-kind',
    'ipfs',
  );
  const ipfsIcon = await ui.locator('.tab.active img').getAttribute('src');
  await go(`ipns://${peer}/`);
  await page(`/ipns/${peer}/`);
  await expect(ui.locator('.tab.active img')).toHaveAttribute(
    'data-kind',
    'ipns',
  );
  expect(await ui.locator('.tab.active img').getAttribute('src')).toBe(
    ipfsIcon,
  );
  await ui.locator('#bookmark').click();
  await expect(
    ui.locator(`#bookmarks-bar a[href="ipns://${peer}/"] img`),
  ).toHaveAttribute('data-kind', 'ipns');
  await expect(
    ui.evaluate(
      (url) =>
        window.browser.command({
          action: 'saveFavicon',
          url,
          image: 'data:image/svg+xml;base64,AA==',
          sourceKey: '[]',
        }),
      base,
    ),
  ).rejects.toThrow();
});

test('keeps all Electron profile, session, log, crash and temp paths inside the configured root', async () => {
  const paths = await app.evaluate(({ app }) =>
    Object.fromEntries(
      ['userData', 'sessionData', 'logs', 'crashDumps', 'temp'].map((name) => [
        name,
        app.getPath(name as 'userData'),
      ]),
    ),
  );
  for (const path of Object.values(paths))
    expect(path === profile || path.startsWith(profile + '/')).toBe(true);
  expect(paths.userData).toBe(profile);
  expect(paths.sessionData).toBe(profile);
  await access(join(profile, 'browser.sqlite'));
  await access(join(profile, 'bookmarks.json'));
  await access(join(profile, 'ipfs', 'config'));
});
