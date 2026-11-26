import { browserUI, launchBrowser } from './browser-ui';
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

test('preserves the restored session when a new HTTP tab opens during Kubo startup', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'perun-session-'));
  const repo = join(profile, 'ipfs');
  const config = join(repo, 'config');
  const server = createServer((_request, res) => res.end('HTTP ready'));
  const db = new DatabaseSync(join(profile, 'browser.sqlite'));
  let app: Awaited<ReturnType<typeof launchBrowser>> | undefined;
  try {
    const kubo = (args: string[], input?: string) =>
      execFileSync(resolve('resources/kubo/ipfs'), args, {
        env: { ...process.env, IPFS_PATH: repo },
        encoding: 'utf8',
        input,
      }).trim();
    kubo(['init', '--profile=lowpower']);
    const cid = kubo(['add', '-Q', '--cid-version=1'], 'Restored content');
    const saved = `ipfs://${cid}/`;
    db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT INTO settings VALUES(?, ?)').run(
      'tabs',
      JSON.stringify([saved]),
    );

    // Hold the initial config read until the HTTP navigation has been persisted.
    const original = await readFile(config);
    await rm(config);
    execFileSync('mkfifo', [config]);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
      throw Error('Missing HTTP port');
    const http = `http://127.0.0.1:${address.port}/`;
    app = await launchBrowser({
      args: ['.'],
      env: {
        ...process.env,
        IPFS_BROWSER_PROFILE: profile,
        IPFS_BROWSER_OFFLINE: '1',
      },
    });
    const ui = await browserUI(app);
    await ui.evaluate(
      (url) => window.browser.command({ action: 'new', url }),
      http,
    );
    const tabs = () =>
      db.prepare("SELECT value FROM settings WHERE key = 'tabs'").get()?.value;
    await expect
      .poll(tabs)
      .toBe(JSON.stringify({ urls: [saved, http], active: 1 }));
    await expect
      .poll(
        () =>
          db
            .prepare('SELECT count(*) AS visits FROM history WHERE url = ?')
            .get(http)?.visits,
      )
      .toBeGreaterThan(0);
    await writeFile(config, original);
    await expect
      .poll(() =>
        app!
          .context()
          .pages()
          .find((p) => p.url().includes(cid))
          ?.locator('body')
          .innerText(),
      )
      .toContain('Restored content');
    expect(tabs()).toBe(JSON.stringify({ urls: [saved, http], active: 1 }));
  } finally {
    await app?.close();
    db.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('restores 31 legacy tabs and remembers the second tab on the next launch', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'perun-many-tabs-'));
  const fixture = join(profile, 'tab.html');
  const urls = Array.from(
    { length: 31 },
    (_, i) => pathToFileURL(fixture).href + '#' + i,
  );
  const launch = () =>
    launchBrowser({
      args: ['.'],
      env: {
        ...process.env,
        IPFS_BROWSER_PROFILE: profile,
        IPFS_BROWSER_OFFLINE: '1',
      },
    });
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    await writeFile(fixture, '<title>Loaded tab</title>');
    const db = new DatabaseSync(join(profile, 'browser.sqlite'));
    try {
      db.exec(
        'CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)',
      );
      db.prepare('INSERT INTO settings VALUES(?, ?)').run(
        'tabs',
        JSON.stringify(urls),
      );
    } finally {
      db.close();
    }
    app = await launch();
    let ui = await browserUI(app);
    await expect(ui.locator('.tab')).toHaveCount(31);
    await expect(ui.locator('#address')).toHaveValue(urls[30]);
    expect(
      await app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].contentView.children.length,
      ),
    ).toBeLessThanOrEqual(2);
    await ui.locator('.tab').nth(1).locator('button').first().click();
    await expect(ui.locator('.tab.active')).toContainText('Loaded tab');
    await expect(ui.locator('#address')).toHaveValue(urls[1]);
    await app.close();
    app = await launch();
    ui = await browserUI(app);
    await expect(ui.locator('.tab')).toHaveCount(31);
    await expect(ui.locator('.tab').nth(1)).toHaveClass(/active/);
    await expect(ui.locator('#address')).toHaveValue(urls[1]);
    await ui.locator('.tab').last().locator('button').first().click();
    await expect(ui.locator('.tab.active')).toContainText('Loaded tab');
    await expect(ui.locator('#address')).toHaveValue(urls[30]);
  } finally {
    await app?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
