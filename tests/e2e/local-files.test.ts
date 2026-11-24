import { browserUI } from './browser-ui';
import { test, expect, _electron } from '@playwright/test';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('opens local files and directories through browser chrome and blocks web pages from opening them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'perun-local-files-'));
  const folder = pathToFileURL(directory + '/').href;
  const local = new URL('Perun%20fixture.html', folder).href;
  await writeFile(
    join(directory, 'Perun fixture.html'),
    `<!doctype html>
    <h1>Local fixture</h1><link rel="stylesheet" href="style.css">
    <a href="./next.txt">Next local file</a><script src="./script.js"></script>`,
  );
  await writeFile(
    join(directory, 'style.css'),
    'h1 { color: rgb(15, 25, 35); }',
  );
  await writeFile(
    join(directory, 'script.js'),
    'document.body.dataset.loaded = "yes";',
  );
  await writeFile(join(directory, 'next.txt'), 'Read from disk');
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(`<h1>Web fixture</h1><a href="${local}">Local link</a>
      <a href="${local}" target="_blank">Local popup</a><iframe src="${local}"></iframe>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw Error('Missing fixture address');
  const remote = `http://127.0.0.1:${address.port}/`;
  try {
    const app = await _electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        IPFS_BROWSER_PROFILE: join(directory, 'profile'),
        IPFS_BROWSER_OFFLINE: '1',
      },
    });
    try {
      const ui = await browserUI(app);
      await expect(ui.locator('#node')).toContainText(/Ready|Gotowy/);
      const open = async (url: string, expectedURL = url) => {
        await ui.locator('#address').fill(url);
        await ui.locator('#address').press('Enter');
        await expect
          .poll(() =>
            app
              .context()
              .pages()
              .some((page) => page.url() === expectedURL),
          )
          .toBe(true);
        return app
          .context()
          .pages()
          .find((page) => page.url() === expectedURL)!;
      };
      const web = await open(remote);
      await web.getByText('Local popup').click();
      await web.getByText('Local link').click();
      await expect(web).toHaveURL(remote);
      expect(web.frames().some((frame) => frame.url() === local)).toBe(false);
      expect(
        app
          .context()
          .pages()
          .some((page) => page.url() === local),
      ).toBe(false);
      const listing = await open(folder.slice(0, -1), folder);
      await listing.getByText('Perun fixture.html', { exact: true }).click();
      await expect(listing).toHaveURL(local);
      await expect(listing.getByRole('heading')).toHaveCSS(
        'color',
        'rgb(15, 25, 35)',
      );
      await expect(listing.locator('body')).toHaveAttribute(
        'data-loaded',
        'yes',
      );
      expect(
        await listing.evaluate(() => [
          typeof Reflect.get(window, 'ipfs'),
          typeof window.browser,
        ]),
      ).toEqual(['undefined', 'undefined']);
      await listing.getByText('Next local file').click();
      await expect(listing.getByText('Read from disk')).toBeVisible();
      await ui.locator('#back').click();
      await expect(listing).toHaveURL(local);
      await open(remote);
      const filePage = await open(local);
      await expect(filePage.getByRole('heading')).toHaveText('Local fixture');
    } finally {
      await app.close();
    }
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
