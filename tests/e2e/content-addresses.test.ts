import { browserUI, launchBrowser } from './browser-ui';
import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { KuboEngine } from '../../src/main/ipfs/engine';

test('native IPFS and IPNS URLs work in navigation and embedded resources', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'perun-content-addresses-'));
  const profile = join(directory, 'profile');
  const site = join(directory, 'site');
  await mkdir(join(site, 'assets'), { recursive: true });
  const engine = new KuboEngine(
    resolve('resources/kubo/ipfs'),
    join(profile, 'ipfs'),
    true,
  );
  let app: ElectronApplication | undefined;
  try {
    await engine.start();
    const gif = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64',
    );
    const image = join(site, 'assets', 'image.gif');
    await writeFile(image, gif);
    const v0 = await engine.cli(
      'add',
      '-Q',
      '--cid-version=0',
      '--raw-leaves=false',
      image,
    );
    const v1 = await engine.cli('add', '-Q', '--cid-version=1', image);
    const name = (await engine.json<{ ID: string }>('id')).ID;
    await writeFile(join(site, 'assets', 'data.json'), '{"online":true}');
    await writeFile(join(site, 'assets', 'note.txt'), 'download fixture');
    await writeFile(
      join(site, 'assets', 'frame.html'),
      '<h1>Frame fixture</h1>',
    );
    await writeFile(
      join(site, 'assets', 'site.css'),
      `#external { width:12px; height:12px; background: url(ipfs://${v0}?css); }`,
    );
    await writeFile(
      join(site, 'assets', 'site.js'),
      'document.body.dataset.script = "yes";',
    );
    await writeFile(
      join(site, 'assets', 'app.webmanifest'),
      '{"name":"Perun test"}',
    );
    await writeFile(
      join(site, 'index.html'),
      `<!doctype html>
      <link rel="icon" href="./assets/image.gif">
      <link rel="stylesheet" href="./assets/site.css">
      <link rel="manifest" href="./assets/app.webmanifest">
      <link rel="preload" as="image" href="ipfs://${v1}">
      <script defer src="./assets/site.js"></script>
      <h1>URL fixtures</h1>
      <img id="v0" src="ipfs://${v0}">
      <img id="v1" src="ipfs://${v1}">
      <img id="ipns" src="ipns://${name}/assets/image.gif">
      <img id="absolute" src="/assets/image.gif">
      <img id="relative" src="assets/image.gif?size=1#preview">
      <picture><source srcset="ipfs://${v0} 1x, ipfs://${v1} 2x"><img id="picture"></picture>
      <input id="button" type="image" src="ipfs://${v0}?input">
      <div id="external"></div>
      <div style="width:1px;height:1px;background-image:image-set(url(ipfs://${v1}?imageset) 1x)"></div>
      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="ipfs://${v1}?svg" width="10" height="10"/></svg>
      <object data="ipfs://${v1}?object" type="image/gif"></object>
      <embed src="ipfs://${v0}?embed" type="image/gif">
      <video poster="ipfs://${v1}?poster"></video>
      <iframe src="ipns://${name}/assets/frame.html"></iframe>
      <a href="#anchor">Fragment</a>
      <a href="./assets/note.txt" download>Download</a>
      <a href="/assets/note.txt" download>Root download</a>
      <a href="ipns://${name}/assets/frame.html?popup=1#test" target="_blank">Popup</a>
      <form action="/assets/frame.html"><input name="q" value="ipfs"><button>Submit</button></form>
      <div id="anchor">Anchor</div>`,
    );
    const cid = await engine.cli('add', '-Qr', site);
    await engine.cli('name', 'publish', '--allow-offline', '/ipfs/' + cid);
    await engine.stop();
    app = await launchBrowser({
      args: ['.'],
      env: {
        ...process.env,
        IPFS_BROWSER_PROFILE: profile,
        IPFS_BROWSER_OFFLINE: '1',
      },
    });
    const ui = await browserUI(app);
    await expect(ui.locator('#node')).toContainText(/Ready|Gotowy/);
    const loaded = new Set<string>();
    app.context().on('response', (response) => {
      if (response.ok()) loaded.add(new URL(response.url()).search);
    });
    await ui.locator('#address').fill('ipns://' + name + '/');
    await ui.locator('#address').press('Enter');
    await expect
      .poll(() =>
        app!
          .context()
          .pages()
          .some((page) => page.url().includes('/ipns/' + name)),
      )
      .toBe(true);
    const page = app
      .context()
      .pages()
      .find((page) => page.url().includes('/ipns/' + name))!;
    await expect(page.locator('body')).toHaveAttribute('data-script', 'yes');
    expect(await page.evaluate(() => typeof Reflect.get(window, 'ipfs'))).toBe(
      'undefined',
    );
    for (const id of ['v0', 'v1', 'ipns', 'absolute', 'relative', 'picture']) {
      await expect
        .poll(
          () =>
            page
              .locator('#' + id)
              .evaluate((image: HTMLImageElement) => image.naturalWidth),
          { message: id },
        )
        .toBe(1);
    }
    await app.evaluate(({ Menu }) => {
      Menu.prototype.popup = function () {
        const item = this.items.find((entry) =>
          /Open image in new window|Otwórz obraz w nowym oknie/.test(
            entry.label,
          ),
        );
        if (item) Reflect.apply(item.click, item, []);
      };
    });
    await page.locator('#v0').click({ button: 'right' });
    await expect
      .poll(() =>
        app!.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().map((window) =>
            window.webContents.getURL(),
          ),
        ),
      )
      .toContain('p2p://shared/ipfs/' + v0 + '/');
    await app.evaluate(({ BrowserWindow }, cid) => {
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().includes('/ipfs/' + cid))
        ?.close();
    }, v0);
    await app.evaluate(({ Menu }) => {
      Menu.prototype.popup = function () {
        const item = this.items.find((entry) =>
          /Open image in new tab|Otwórz obraz w nowej karcie/.test(entry.label),
        );
        if (item) Reflect.apply(item.click, item, []);
      };
    });
    await page.locator('#v1').click({ button: 'right' });
    await expect
      .poll(() =>
        app!
          .context()
          .pages()
          .map((tab) => tab.url()),
      )
      .toContain('p2p://shared/ipfs/' + v1 + '/');
    expect(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);
    await ui.locator('#tabs .tab:first-child button').first().click();
    await expect(page.frameLocator('iframe').getByRole('heading')).toHaveText(
      'Frame fixture',
    );
    await expect
      .poll(() =>
        [...loaded]
          .filter((url) =>
            [
              '?css',
              '?input',
              '?imageset',
              '?svg',
              '?object',
              '?embed',
              '?poster',
            ].includes(url),
          )
          .sort(),
      )
      .toEqual([
        '?css',
        '?embed',
        '?imageset',
        '?input',
        '?object',
        '?poster',
        '?svg',
      ]);
    await expect(
      ui.locator('img.site-icon[data-favicon="true"]').first(),
    ).toBeAttached();
    const cdp = await app.context().newCDPSession(page);
    const manifest = await cdp.send('Page.getAppManifest');
    expect(manifest.data).toContain('Perun test');
    await cdp.detach();
    const results = await page.evaluate(
      async ({ cid, name }) =>
        Promise.all([
          fetch('ipfs://' + cid + '/assets/data.json').then((response) =>
            response.json(),
          ),
          fetch('ipns://' + name + '/assets/data.json').then((response) =>
            response.json(),
          ),
        ]),
      { cid, name },
    );
    expect(results).toEqual([{ online: true }, { online: true }]);
    expect(
      await page.evaluate(async (cid) => {
        const response = await fetch('ipfs://' + cid, {
          headers: { Range: 'bytes=0-2' },
        });
        return [response.status, await response.text()];
      }, v0),
    ).toEqual([206, 'GIF']);
    await page.getByText('Fragment', { exact: true }).click();
    await expect(page).toHaveURL(/#anchor$/);
    await ui.locator('#site-settings').click();
    await ui.locator('#site-copy-source').click();
    const original = await readFile(join(site, 'index.html'), 'utf8');
    await expect
      .poll(() => app!.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(original);
    await ui.locator('#site-dialog [data-dismiss]').click();
    const destination = join(directory, 'download.txt');
    await app.evaluate(({ dialog }, path) => {
      Object.assign(dialog, {
        showSaveDialog: async () => ({ canceled: false, filePath: path }),
      });
      dialog.showErrorBox = () => {};
    }, destination);
    await page
      .getByText('Download', { exact: true })
      .evaluate((link: HTMLAnchorElement) => link.click());
    await expect
      .poll(() => readFile(destination, 'utf8').catch(() => ''))
      .toBe('download fixture');
    const rootDestination = join(directory, 'root-download.txt');
    await app.evaluate(({ dialog }, path) => {
      Object.assign(dialog, {
        showSaveDialog: async () => ({ canceled: false, filePath: path }),
      });
    }, rootDestination);
    await page
      .getByText('Root download', { exact: true })
      .evaluate((link: HTMLAnchorElement) => link.click());
    await expect
      .poll(() => readFile(rootDestination, 'utf8').catch(() => ''))
      .toBe('download fixture');
    await page.getByText('Popup', { exact: true }).click();
    await expect
      .poll(() =>
        app!
          .context()
          .pages()
          .some((page) =>
            page.url().endsWith('/assets/frame.html?popup=1#test'),
          ),
      )
      .toBe(true);
    await page
      .locator('form button')
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect(page).toHaveURL(/\/assets\/frame.html\?q=ipfs$/);
  } finally {
    await app?.close();
    await engine.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
