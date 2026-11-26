import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import MakerAppImage from './scripts/maker-appimage.mts';
import { prefixArtifact } from './scripts/release-artifacts.mts';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

// The explicit staging path also works with RPM 6's per-package build directory.
const rpmSpec = {
  specTemplate: 'scripts/perun-rpm.spec.ejs',
  desktopTemplate: 'scripts/perun.desktop.ejs',
};

const config: ForgeConfig = {
  packagerConfig: {
    asar: { unpack: '*.node' },
    // Vite bundles application code. Electron Packager prunes development
    // dependencies and keeps the native repo lock and its runtime loader.
    ignore: (path) => {
      if (path.startsWith('/node_modules/fs-native-extensions/prebuilds/'))
        return (
          !path.endsWith('/linux-x64') &&
          !path.endsWith('/linux-x64/fs-native-extensions.node')
        );
      return (
        !!path && !/^\/(?:\.vite(?:\/|$)|node_modules(?:$|\/[^.]))/.test(path)
      );
    },
    name: 'ipfs-browser',
    executableName: 'ipfs-browser',
    extraResource: [
      'resources/branding',
      'resources/kubo/ipfs',
      'resources/kubo/LICENSE',
      'resources/kubo/LICENSE-APACHE',
      'resources/kubo/LICENSE-MIT',
    ],
  },
  rebuildConfig: {},
  hooks: {
    postMake: async (_config, results) => {
      for (const result of results) {
        result.artifacts = await Promise.all(
          result.artifacts.map(prefixArtifact),
        );
      }
      return results;
    },
  },
  makers: [
    new MakerZIP({}, ['linux']),
    new MakerAppImage(),
    new MakerRpm({
      options: {
        icon: 'resources/branding/perun.png',
        homepage: 'https://github.com/pe-run/perun-ipfs-browser-core',
        categories: ['Network'],
        ...rpmSpec,
      },
    }),
    new MakerDeb({
      options: {
        icon: 'resources/branding/perun.png',
        desktopTemplate: 'scripts/perun.desktop.ejs',
        maintainer: 'Perun IPFS Browser contributors',
        homepage: 'https://github.com/pe-run/perun-ipfs-browser-core',
        categories: ['Network'],
      },
    }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
