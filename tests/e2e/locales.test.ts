import { browserUI } from './browser-ui';
import { parseAddress } from '../../src/shared/address';
import { catalog } from '../../src/shared/catalog';
import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveLanguage,
  translate,
  type Language,
} from '../../src/shared/i18n';
test('uses the system UI language, switches all ten languages, keeps catalog paths and persists the preference', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'perun-languages-'));
  const launch = () =>
    electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        IPFS_BROWSER_PROFILE: profile,
        IPFS_BROWSER_OFFLINE: '1',
      },
    });
  let app = await launch();
  try {
    let ui = await browserUI(app);
    const languages = await app.evaluate(({ app }) =>
      app.getPreferredSystemLanguages(),
    );
    const detected = resolveLanguage(languages);
    await expect(ui.locator('html')).toHaveAttribute('lang', detected);
    await expect(ui.locator('#language')).toHaveValue('auto');
    await expect(ui.locator('#catalog-links a')).toHaveCount(catalog.length);
    const version = await app.evaluate(({ app }) => app.getVersion());
    await expect(ui.locator('#app-version')).toContainText(version);
    await expect(ui.locator('#about-browser')).not.toBeEmpty();
    await ui.locator('#catalog-category').selectOption('documentation');
    await expect(ui.locator('#catalog-links a')).toHaveCount(
      catalog.filter((e) => e.category === 'documentation').length,
    );
    const secondCategory = catalog.find(
      (e) => e.category !== 'documentation',
    )!.category;
    await ui.locator('#catalog-category').selectOption(secondCategory);
    await expect(ui.locator('#catalog-links a')).toHaveCount(
      catalog.filter((e) => e.category === secondCategory).length,
    );
    await ui.locator('#catalog-category').selectOption('previous');
    await expect(ui.locator('#catalog-links a')).toHaveCount(
      catalog.filter((e) => e.category === 'previous').length,
    );
    await ui.locator('#catalog-category').selectOption('all');
    await ui.locator('#settings').click();
    await expect(ui.locator('#settings-dialog')).toBeVisible();
    const urls = await ui
      .locator('#catalog-links a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    for (const language of [
      'en',
      'pl',
      'es',
      'fr',
      'zh',
      'pt',
      'de',
      'ru',
      'ja',
      'ko',
    ] as Language[]) {
      await ui.locator('#language').selectOption(language);
      await expect(ui.locator('html')).toHaveAttribute('lang', language);
      await expect(ui.locator('#home')).toHaveText(translate(language, 'home'));
      await expect(ui.locator('#catalog-heading')).toHaveText(
        translate(language, 'catalog'),
      );
      await expect(ui.locator('#catalog-links a').first()).toHaveText(
        catalog[0].titles?.[language] || catalog[0].title,
      );
      expect(
        await ui
          .locator('#catalog-links a')
          .evaluateAll((links) =>
            links.map((link) => link.getAttribute('href')),
          ),
      ).toEqual(urls);
      expect(
        await app.evaluate(
          ({ Menu }) => Menu.getApplicationMenu()!.items[0].label,
        ),
      ).toBe(translate(language, 'browser'));
    }
    await expect(
      ui.evaluate(() =>
        window.browser.command({
          action: 'setLanguage',
          language: 'xx' as 'en',
        }),
      ),
    ).rejects.toThrow();
    await ui.locator('#language').selectOption('es');
    await expect(ui.locator('#home')).toHaveText('Inicio');
    await app.close();
    app = await launch();
    ui = await browserUI(app);
    await expect(ui.locator('html')).toHaveAttribute('lang', 'es');
    await expect(ui.locator('#language')).toHaveValue('es');
    // Spy on loadURL only for this test so no public CID/network availability is required.
    await app.evaluate(({ webContents }) => {
      const proto = Object.getPrototypeOf(webContents.getAllWebContents()[0]);
      proto.loadURL = async function (url: string) {
        (globalThis as unknown as { catalogURL: string }).catalogURL = url;
      };
    });
    await ui.evaluate(() =>
      window.browser.command({ action: 'dismissOverlay' }),
    );
    await ui.locator('#catalog-links a').first().click();
    await expect
      .poll(() =>
        app.evaluate(
          () => (globalThis as unknown as { catalogURL: string }).catalogURL,
        ),
      )
      .toBe(parseAddress(catalog[0].url).internal);
    await ui.evaluate(() => window.browser.command({ action: 'home' }));
    await ui.locator('#settings').click();
    await ui.locator('#language').selectOption('auto');
    await expect(ui.locator('html')).toHaveAttribute('lang', detected);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
