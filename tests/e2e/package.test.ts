import { catalog } from '../../src/shared/catalog';
import packageInfo from '../../package.json';
import { test, expect, chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
test('packaged Linux app starts outside source tree, runs bundled Kubo and stops it on quit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'browser-package-'));
  const executable =
    process.env.PERUN_TEST_PACKAGED_EXECUTABLE ||
    resolve('out/ipfs-browser-linux-x64/ipfs-browser');
  await access(executable);
  const child = spawn(
    executable,
    ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'],
    {
      cwd: dir,
      env: {
        ...process.env,
        IPFS_BROWSER_PROFILE: join(dir, 'profile'),
        IPFS_BROWSER_OFFLINE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let logs = '';
  child.stdout.on('data', (b) => (logs += b));
  child.stderr.on('data', (b) => (logs += b));
  try {
    await expect
      .poll(() => {
        if (child.exitCode !== null || child.signalCode !== null)
          throw Error(
            `Electron exited (${child.signalCode ?? child.exitCode})\n${logs}`,
          );
        return /DevTools listening on (ws:\/\/[^\s]+)/.exec(logs)?.[1];
      })
      .toBeTruthy();
    const endpoint = /DevTools listening on (ws:\/\/[^\s]+)/.exec(logs)![1];
    const browser = await chromium.connectOverCDP(endpoint);
    const ui = browser.contexts()[0].pages()[0];
    await ui.evaluate(() =>
      window.browser.command({ action: 'setLanguage', language: 'pl' }),
    );
    await expect(ui.locator('#window-title')).toHaveText('Perun IPFS Browser');
    const titlebar = await ui.locator('.window-titlebar').evaluate((bar) => ({
      top: bar.getBoundingClientRect().top,
      drag:
        getComputedStyle(bar).getPropertyValue('app-region') ||
        getComputedStyle(bar).getPropertyValue('-webkit-app-region'),
      logoRight: bar.querySelector('img')!.getBoundingClientRect().right,
      titleLeft: bar.querySelector('#window-title')!.getBoundingClientRect()
        .left,
    }));
    expect(titlebar.top).toBe(0);
    expect(titlebar.drag).toBe('drag');
    expect(titlebar.logoRight).toBeLessThan(titlebar.titleLeft);
    await expect(ui.locator('h1')).toHaveText('Perun IPFS Browser');
    await expect(ui.locator('#app-version')).toContainText(packageInfo.version);
    await expect(ui.locator('#catalog-links a')).toHaveCount(catalog.length);
    // Assert packaged SVGs load under the real CSP without a Vite development server.
    await expect
      .poll(() =>
        ui
          .locator('img')
          .evaluateAll((images) =>
            images.every(
              (img) =>
                (img as HTMLImageElement).complete &&
                (img as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    await expect(
      ui.getByRole('img', { name: 'Logo Perun IPFS Browser', exact: true }),
    ).toBeVisible();
    await access(
      resolve('out/ipfs-browser-linux-x64/resources/branding/perun.png'),
    );
    await expect(
      access(resolve('out/ipfs-browser-linux-x64/resources/perun-reader')),
    ).rejects.toThrow();
    await expect(ui.locator('#protocol')).toHaveCount(0);
    await expect(ui.locator('#node')).toHaveText('IPFS: Gotowy', {
      timeout: 40000,
    });
    await ui.locator('#stats').click();
    await expect(ui.locator('#details')).toContainText('PeerID');
    await ui.screenshot({ path: 'test-results/packaged-browser.png' });
    const exit = new Promise<void>((r) => child.once('exit', () => r()));
    child.kill('SIGTERM');
    await exit;
    expect(child.exitCode).toBe(0);
    await expect(
      access(join(dir, 'profile', 'ipfs', 'rpc.sock')),
    ).rejects.toThrow();
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise<void>((r) => {
        child.once('exit', () => r());
        setTimeout(() => {
          child.kill('SIGKILL');
          r();
        }, 10000).unref();
      });
    }
    await rm(dir, { recursive: true, force: true });
  }
});
