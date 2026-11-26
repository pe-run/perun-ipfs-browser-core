import { launchBrowser } from './browser-ui';
import { test, expect } from '@playwright/test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Processes of this user whose environment points at the given IPFS repo. */
async function kuboProcesses(repo: string) {
  const found: number[] = [];
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const environ = await readFile(`/proc/${entry}/environ`, 'utf8');
      if (environ.split('\0').includes(`IPFS_PATH=${repo}`))
        found.push(Number(entry));
    } catch {
      /* exited or not ours */
    }
  }
  return found;
}

test('quits promptly when closed during startup and leaves no Kubo behind', async () => {
  for (const delay of [0, 0, 50, 300]) {
    const profile = await mkdtemp(join(tmpdir(), 'browser-quit-'));
    try {
      const app = await launchBrowser({
        args: ['.'],
        env: {
          ...process.env,
          IPFS_BROWSER_PROFILE: profile,
          IPFS_BROWSER_OFFLINE: '1',
        },
      });
      // The window may still be loading the interface when the quit arrives.
      await app.firstWindow();
      await new Promise((resolve) => setTimeout(resolve, delay));
      const started = Date.now();
      await app.close();
      expect(Date.now() - started).toBeLessThan(10000);
      await expect.poll(() => kuboProcesses(join(profile, 'ipfs'))).toEqual([]);
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }
});
