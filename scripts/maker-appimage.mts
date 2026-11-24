import Maker, { type MakerOptions } from '@electron-forge/maker-base';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const exec = promisify(execFile);

export default class MakerAppImage extends Maker<Record<string, never>> {
  name = 'appimage';
  defaultPlatforms = ['linux'] as const satisfies ['linux'];
  requiredExternalBinaries = ['appimagetool'];

  isSupportedOnCurrentPlatform() {
    return process.platform === 'linux';
  }

  async make({ dir, makeDir, targetArch, packageJSON }: MakerOptions) {
    if (targetArch !== 'x64')
      throw Error('AppImage currently supports Linux x64');
    const scratch = await mkdtemp(join(tmpdir(), 'perun-appimage-'));
    const appDir = join(scratch, 'Perun.AppDir');
    try {
      await cp(dir, appDir, { recursive: true, verbatimSymlinks: true });
      // The packager output is 0700; an AppImage is run by other users, and
      // appimagetool refuses AppDirs they could not read or execute.
      await exec('chmod', ['-R', 'a+rX', appDir]);
      // A portable mount cannot install a root-owned SUID helper.
      await rm(join(appDir, 'chrome-sandbox'), { force: true });
      await writeFile(
        join(appDir, 'AppRun'),
        [
          '#!/bin/sh',
          'app_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1',
          'exec "$app_dir/ipfs-browser" "$@"',
          '',
        ].join('\n'),
        { mode: 0o755 },
      );
      await writeFile(
        join(appDir, 'ipfs-browser.desktop'),
        [
          '[Desktop Entry]',
          'Type=Application',
          'Name=Perun IPFS Browser',
          'Exec=ipfs-browser %U',
          'Icon=perun',
          'StartupWMClass=ipfs-browser',
          'Categories=Network;WebBrowser;',
          '',
        ].join('\n'),
      );
      await copyFile(
        join(appDir, 'resources', 'branding', 'perun.png'),
        join(appDir, 'perun.png'),
      );
      const destination = resolve(makeDir, 'appimage', targetArch);
      await mkdir(destination, { recursive: true });
      const artifact = join(
        destination,
        `perun-ipfs-browser-${packageJSON.version}-x86_64.AppImage`,
      );
      await exec('appimagetool', ['--no-appstream', appDir, artifact], {
        env: { ...process.env, ARCH: 'x86_64', APPIMAGE_EXTRACT_AND_RUN: '1' },
      });
      return [artifact];
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
