import { expect, type ElectronApplication, type Page } from '@playwright/test';

/**
 * Return the trusted browser chrome page. `app.firstWindow()` is not reliable:
 * restored tabs and the loading indicator are WebContents that can appear before
 * the interface finishes loading.
 */
export async function browserUI(app: ElectronApplication): Promise<Page> {
  const chrome = () =>
    app
      .context()
      .pages()
      .find((page) => page.url().endsWith('/main_window/index.html'));
  await expect.poll(chrome, { timeout: 30000 }).toBeDefined();
  const ui = chrome()!;
  await ui.waitForLoadState();
  return ui;
}
