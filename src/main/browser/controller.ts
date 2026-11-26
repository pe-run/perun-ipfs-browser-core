import { Favicons } from './favicons';
import {
  readLimitedBody,
  readLimitedFile,
  renderedSource,
  serializedDocument,
  SourceTooLargeError,
} from './page-source';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { copyFile, rename, rm } from 'node:fs/promises';
import { linkPreviewURL } from '../../shared/link-preview';
import { sitePreferences, siteScope } from './preferences';
import {
  t,
  setLocale,
  getLocale,
  resolveLanguage,
  isLanguage,
  localizeMessage,
  type LanguagePreference,
} from '../../shared/i18n';
import {
  app,
  BrowserWindow,
  WebContentsView,
  dialog,
  clipboard,
  Menu,
  nativeImage,
} from 'electron';
import type { Session } from 'electron';
import { requestRedirect } from '../ipfs/request-address';
import {
  canBookmark,
  navigationAddress,
  parseAddress,
} from '../../shared/address';
import type {
  Bookmark,
  BrowserState,
  Command,
  TabState,
  SiteInfo,
} from '../../shared/types';
import {
  isAuthorizedLocalNavigation,
  loadLocalURL,
  securePreferences,
} from '../security/policy';
import type { ImportResult } from '../ipfs/import';
import type { Store } from '../storage/store';
import type { IPFSEngine } from '../ipfs/engine';
type Tab = {
  view: WebContentsView;
  state: TabState;
  home: boolean;
  favicons?: string[];
  navigationURL?: string;
};
type SavedTab = Pick<Tab, 'state' | 'home'> & { view?: undefined };
/** Input that grants a page one popup, like Chromium's transient user activation. */
const activationInputs = new Set([
  'mouseDown',
  'mouseUp',
  'rawKeyDown',
  'keyDown',
  'touchEnd',
  'gestureTap',
]);
const activationMs = 5000;
async function moveFile(from: string, to: string) {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await copyFile(from, to);
    await rm(from, { force: true });
  }
}
export class BrowserController {
  private tabs: (SavedTab | Tab)[] = [];
  private active = 0;
  private panel = true;
  private toolbarHeight = 112;
  private bookmarkMenu?: Menu;
  private favicons: Favicons;
  private overlay: BrowserState['overlay'] = null;
  private importing = false;
  private pendingImport?: { result: ImportResult; pinRecorded: boolean };
  private imported = new Set<string>();
  private languagePreference: LanguagePreference;
  constructor(
    private window: BrowserWindow,
    private session: Session,
    private store: Store,
    private engine: IPFSEngine,
    private preferredLanguages: string[],
    private onLanguageChanged: () => void,
  ) {
    this.favicons = new Favicons(session, store);
    const saved = this.store.get<unknown>('language', 'auto');
    this.languagePreference = isLanguage(saved) ? saved : 'auto';
    setLocale(
      this.languagePreference === 'auto'
        ? resolveLanguage(preferredLanguages)
        : this.languagePreference,
    );
    window.on('resize', () => this.layout());
    window.on('blur', () => this.previewLink(''));
    window.webContents.on('update-target-url', (_event, url) => {
      if (!this.overlay) this.previewLink(url);
    });
    window.on('page-title-updated', (event) => event.preventDefault());
    session.on('will-download', (_event, item, contents) => {
      try {
        const target = requestRedirect(item.getURL(), contents?.getURL());
        if (target) {
          item.cancel();
          if (contents && !contents.isDestroyed()) contents.downloadURL(target);
          return;
        }
      } catch {
        item.cancel();
        return;
      }
      // Electron needs the save path synchronously, but a synchronous dialog would
      // freeze the main process (IPC, protocol handlers). Download to a private
      // temporary file and move it once the asynchronous dialog has an answer.
      const temporary = join(
        app.getPath('temp'),
        `download-${randomUUID()}.part`,
      );
      item.setSavePath(temporary);
      const destination = dialog
        .showSaveDialog(window, { defaultPath: item.getFilename() })
        .then(
          ({ canceled, filePath }) => (canceled ? undefined : filePath),
          () => undefined,
        );
      void destination.then((path) => {
        if (!path && item.getState() === 'progressing') item.cancel();
      });
      const fail = (error: string) => {
        if (!window.isDestroyed())
          dialog.showErrorBox(t('download'), t('downloadFailed', { error }));
      };
      item.once('done', (_e, state) => {
        void (async () => {
          const path = await destination;
          try {
            if (state === 'completed' && path) await moveFile(temporary, path);
            else if (path) fail(state);
          } catch (error) {
            fail((error as Error).message);
          } finally {
            await rm(temporary, { force: true }).catch(() => {});
          }
        })();
      });
    });
  }
  restore() {
    if (!this.store.get('restoreTabs', true)) {
      this.emit();
      return;
    }
    const saved = this.store.get<
      null | string[] | { urls: string[]; active: number }
    >('tabs', null);
    const urls = Array.isArray(saved) ? saved : saved?.urls;
    if (Array.isArray(urls)) {
      const active = Array.isArray(saved) ? urls.length - 1 : saved?.active;
      let selected: SavedTab | undefined;
      for (const [index, url] of urls.entries()) {
        if (typeof url !== 'string') continue;
        try {
          const address = url ? parseAddress(url).display : '';
          const tab: SavedTab = {
            home: !address,
            state: {
              id: Number.MAX_SAFE_INTEGER - index,
              url: address,
              title: address || t('newTab'),
              loading: false,
              back: false,
              forward: false,
            },
          };
          this.tabs.push(tab);
          if (index === active) selected = tab;
        } catch {
          /* invalid saved tab */
        }
      }
      this.select(selected ?? this.tabs.at(-1));
    }
    this.emit();
  }
  private current() {
    const tab = this.tabs.find((t) => t.state.id === this.active);
    return tab?.view ? tab : undefined;
  }
  private select(tab?: Tab | SavedTab) {
    if (tab && !tab.view) {
      const index = this.tabs.indexOf(tab);
      const url = tab.state.url;
      tab = this.createView();
      this.tabs[index] = tab;
      this.active = tab.state.id;
      if (url) this.load(tab, url);
    }
    this.active = tab?.state.id ?? 0;
    this.panel = tab?.home ?? true;
    if (tab?.favicons)
      this.favicons.observe(tab.view.webContents.getURL(), tab.favicons);
    this.layout();
  }
  private persist() {
    this.store.set('tabs', {
      urls: this.tabs.map((tab) => tab.state.url),
      active: this.tabs.findIndex((tab) => tab.state.id === this.active),
    });
  }
  private lastState = '';
  /** Send the state to the interface; unchanged state is skipped unless forced. */
  emit(force = false) {
    if (this.window.isDestroyed()) return;
    const state: BrowserState = {
      version: app.getVersion(),
      faviconSources: this.favicons.sources,
      tabs: this.tabs.map((t) => t.state),
      active: this.active,
      panel: this.panel,
      overlay: this.overlay,
      node: this.nodeLabel(),
      nodeState: this.engine.state,
      locale: getLocale(),
      languagePreference: this.languagePreference,
    };
    const serialized = JSON.stringify(state);
    if (!force && serialized === this.lastState) return;
    this.lastState = serialized;
    this.window.webContents.send('browser:state', state);
  }
  private previewLink(target: string) {
    if (this.window.isDestroyed()) return;
    const title = linkPreviewURL(target) || 'Perun IPFS Browser';
    this.window.setTitle(title);
    this.window.webContents.send('browser:title', title);
  }
  private nodeLabel() {
    const { state, detail } = this.engine;
    if (state === 'failed') return t('error', { error: detail });
    if (state === 'crashed') return t('nodeCrash', { error: detail });
    return t(state);
  }
  private layout() {
    this.previewLink('');
    const [width, height] = this.window.getContentSize();
    for (const t of this.tabs) {
      if (!t.view) continue;
      t.view.setVisible(
        !this.panel && !this.overlay && t.state.id === this.active,
      );
      t.view.setBounds({
        x: 0,
        y: this.toolbarHeight,
        width,
        height: Math.max(0, height - this.toolbarHeight),
      });
    }
  }
  private create(url?: string, image = false) {
    this.overlay = null;
    const tab = this.createView();
    this.tabs.push(tab);
    this.active = tab.state.id;
    if (url) this.load(tab, url, image);
    else this.panel = true;
    this.layout();
    this.emit();
    this.persist();
    return tab;
  }
  private createView() {
    const view = new WebContentsView({
      webPreferences: {
        ...securePreferences,
        session: this.session,
      },
    });
    const wc = view.webContents;
    wc.setZoomMode('isolated');
    const tab: Tab = {
      view,
      home: true,
      state: {
        id: wc.id,
        url: '',
        title: t('newTab'),
        loading: false,
        back: false,
        forward: false,
      },
    };
    this.window.contentView.addChildView(view);
    // Electron has no popup blocker: without this, a script could open tabs in a loop.
    let activation = 0;
    wc.on('input-event', (_event, input) => {
      if (activationInputs.has(input.type)) activation = Date.now();
    });
    wc.setWindowOpenHandler(({ url }) => {
      const activated = Date.now() - activation < activationMs;
      activation = 0;
      if (!activated) return { action: 'deny' };
      try {
        const target = navigationAddress(
          requestRedirect(url, wc.getURL()) ?? url,
        );
        if (target.kind !== 'file' || wc.getURL().startsWith('file:'))
          this.create(target.display);
      } catch {}
      return { action: 'deny' };
    });
    wc.on('context-menu', (_event, params) => {
      if (params.mediaType !== 'image' || !params.srcURL) return;
      const source = params.frame?.url ?? wc.getURL();
      let url: string;
      try {
        if (/^(?:data:image\/|blob:)/i.test(params.srcURL)) {
          url = params.srcURL;
        } else {
          const address = navigationAddress(
            requestRedirect(params.srcURL, source) ?? params.srcURL,
          );
          if (address.kind === 'file' && !source.startsWith('file:')) return;
          url = address.internal;
        }
      } catch {
        return;
      }
      Menu.buildFromTemplate([
        {
          label: t('openImageTab'),
          click: () => {
            if (wc.isDestroyed()) return;
            const target = url.startsWith('p2p:')
              ? navigationAddress(url).display
              : url;
            this.create(target, true);
          },
        },
        {
          label: t('openImageWindow'),
          click: () => {
            if (wc.isDestroyed()) return;
            const image = new BrowserWindow({
              parent: this.window,
              title: 'Perun IPFS Browser',
              webPreferences: { ...securePreferences, session: this.session },
            });
            image.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
            image.webContents.on('will-navigate', (event) =>
              event.preventDefault(),
            );
            const load = url.startsWith('file:')
              ? loadLocalURL(image.webContents, url)
              : image.loadURL(url);
            void load.catch(() => {
              if (!image.isDestroyed()) image.close();
            });
          },
        },
      ]).popup({ window: this.window });
    });
    wc.on('update-target-url', (_event, url) => {
      if (this.active === wc.id && !this.panel && !this.overlay)
        this.previewLink(url);
    });
    wc.on('will-attach-webview', (e) => e.preventDefault());
    const guard = (event: Electron.Event, target: string) => {
      try {
        const a = navigationAddress(
          requestRedirect(target, wc.getURL()) ?? target,
        );
        if (
          a.kind === 'file' &&
          !wc.getURL().startsWith('file:') &&
          !isAuthorizedLocalNavigation(wc.id, a.internal)
        )
          throw Error(t('forbiddenNavigation'));
        if (a.internal !== target) {
          event.preventDefault();
          this.load(tab, a.display);
        }
      } catch {
        event.preventDefault();
        tab.state.error = t('forbiddenNavigation');
        this.emit();
      }
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.on('did-start-navigation', ({ url, isMainFrame, isSameDocument }) => {
      if (isMainFrame && !isSameDocument) {
        tab.navigationURL = url;
        tab.state.error = undefined;
        this.emit();
      }
    });
    wc.on('did-redirect-navigation', ({ url, isMainFrame }) => {
      if (isMainFrame) tab.navigationURL = url;
    });
    wc.on('did-start-loading', () => {
      if (this.active === wc.id && !this.panel) this.previewLink('');
      tab.state.loading = true;
      tab.state.error = undefined;
      this.emit();
    });
    wc.on('did-stop-loading', () => {
      tab.state.loading = false;
      this.update(tab);
    });
    wc.on('did-navigate', () => {
      // A new document starts without the previous page's user activation.
      activation = 0;
      tab.navigationURL = undefined;
      tab.state.error = undefined;
      this.update(tab);
      this.applySitePreferences(tab);
      if (this.overlay === 'site' && this.active === tab.state.id) {
        this.overlay = null;
        this.layout();
        this.emit();
      }
      if (tab.state.url) this.store.visit(tab.state.url, wc.getTitle());
      this.persist();
    });
    wc.on('did-navigate-in-page', () => {
      if (this.active === wc.id && !this.panel) this.previewLink('');
      this.update(tab);
      this.persist();
    });
    wc.on('page-title-updated', () => this.update(tab));
    wc.on('page-favicon-updated', (_event, urls) => {
      tab.favicons = urls;
      if (this.active === wc.id && this.favicons.observe(wc.getURL(), urls))
        this.emit();
    });
    wc.on('did-fail-load', (_event, code, description, url, isMain) => {
      if (isMain && code !== -3 && url === tab.navigationURL) {
        tab.state.error = t('navigationFailed', { code, error: description });
        tab.state.loading = false;
        this.emit();
      }
    });
    wc.on('render-process-gone', (_event, details) => {
      tab.state.loading = false;
      tab.state.error = t('rendererGone', { error: details.reason });
      this.emit();
    });
    return tab;
  }
  private update(tab: Tab) {
    const wc = tab.view.webContents;
    try {
      tab.state.url = navigationAddress(wc.getURL()).display;
    } catch {}
    tab.state.title = wc.getTitle() || tab.state.url || t('newTab');
    tab.state.back = wc.navigationHistory.canGoBack();
    tab.state.forward = wc.navigationHistory.canGoForward();
    this.emit();
  }
  private load(tab: Tab, url: string, image = false) {
    const a =
      image && /^(?:data:image\/|blob:)/i.test(url)
        ? { kind: 'image', display: '', internal: url }
        : parseAddress(url);
    tab.favicons = undefined;
    tab.state.url = a.display;
    tab.state.error = undefined;
    tab.home = false;
    this.panel = false;
    this.overlay = null;
    this.layout();
    tab.view.webContents.focus();
    const contents = tab.view.webContents;
    tab.navigationURL = a.internal;
    const loading =
      a.kind === 'file'
        ? loadLocalURL(contents, a.internal)
        : contents.loadURL(a.internal);
    // did-fail-load reports navigation failures without surfacing cancelled promises.
    void loading.catch(() => {});
    this.emit();
  }
  private scopedTab(command: Command): Tab {
    const tab = this.current();
    if (!tab || command.id !== tab.state.id || command.url !== tab.state.url)
      throw Error(t('pageChanged'));
    return tab;
  }
  private validateMenuPosition(command: Command) {
    if (this.overlay || command.x === undefined || command.y === undefined)
      throw Error('Invalid menu position');
    const [width, height] = this.window.getContentSize();
    if (
      command.x >= width ||
      command.y > this.toolbarHeight ||
      command.y >= height
    )
      throw Error('Invalid menu position');
  }
  private bookmarkMenuItem(
    bookmark: Bookmark,
    stillListed: (current: Bookmark) => boolean,
  ): Electron.MenuItemConstructorOptions {
    return {
      label: (bookmark.title || bookmark.url).replace(/&/g, '&&'),
      icon:
        this.favicons.icon(bookmark.url) ||
        nativeImage.createFromPath(
          join(
            app.isPackaged
              ? join(process.resourcesPath, 'branding')
              : join(app.getAppPath(), 'resources/branding'),
            `site-${bookmark.url.startsWith('ipfs:') || bookmark.url.startsWith('ipns:') || bookmark.url.startsWith('p2p:') ? 'ipfs' : 'web'}.png`,
          ),
        ),
      click: (_item, _window, event) => {
        // The menu may outlive an edit made in the meantime.
        if (
          !this.store
            .bookmarks()
            .some(
              (current) => current.url === bookmark.url && stillListed(current),
            )
        )
          return;
        void this.command({
          action: event.ctrlKey || event.metaKey ? 'new' : 'navigate',
          url: bookmark.url,
        }).catch((error) => {
          const current = this.current();
          if (current)
            current.state.error = localizeMessage((error as Error).message);
          this.emit();
        });
      },
    };
  }
  private folderMenuItems(id: number): Electron.MenuItemConstructorOptions[] {
    const inFolder = (bookmark: Bookmark) =>
      bookmark.folderId === id || bookmark.shortcutFolderId === id;
    const entries = this.store.bookmarks().filter(inFolder);
    return entries.length
      ? entries.map((bookmark) => this.bookmarkMenuItem(bookmark, inFolder))
      : [{ label: t('emptyFolder'), enabled: false }];
  }
  private popupBookmarkMenu(
    items: Electron.MenuItemConstructorOptions[],
    position: Command,
  ) {
    this.bookmarkMenu?.closePopup(this.window);
    const menu = Menu.buildFromTemplate(items);
    this.bookmarkMenu = menu;
    menu.popup({
      window: this.window,
      x: position.x,
      y: position.y,
      callback: () => {
        if (this.bookmarkMenu === menu) this.bookmarkMenu = undefined;
      },
    });
  }
  private applySitePreferences(tab: Tab) {
    if (!tab.state.url || tab.view.webContents.isDestroyed()) return;
    const preferences = sitePreferences(this.store, tab.state.url);
    tab.view.webContents.setZoomFactor(preferences.zoom / 100);
    tab.view.webContents.setAudioMuted(preferences.muted);
  }
  private async siteInfo(command: Command): Promise<SiteInfo> {
    const tab = this.scopedTab(command),
      a = parseAddress(tab.state.url),
      preferences = sitePreferences(this.store, tab.state.url);
    const result: SiteInfo = {
      id: tab.state.id,
      url: tab.state.url,
      scope: siteScope(tab.state.url),
      kind: a.kind,
      ...preferences,
      pinState: 'unavailable',
    };
    if (a.root && this.engine.state === 'ready') {
      try {
        result.cid =
          a.kind === 'ipns'
            ? (await this.engine.resolveIPNS(a.root)).split('/')[2]
            : a.root;
        result.pinState = (await this.engine.isPinned(result.cid))
          ? 'pinned'
          : 'unpinned';
      } catch {
        result.pinState = 'unavailable';
      }
    }
    this.scopedTab(command);
    return result;
  }
  async command(command: Command) {
    const tab = this.current();
    switch (command.action) {
      case 'getFavicon':
        if (!command.url) throw Error('Invalid favicon URL');
        return this.favicons.get(command.url);
      case 'saveFavicon':
        if (!command.url || !command.image || command.sourceKey === undefined)
          throw Error('Invalid favicon');
        return this.favicons.save(
          command.url,
          command.image,
          command.sourceKey,
        );
      case 'setToolbarHeight':
        // Ranges are checked by parseCommand; only presence matters here.
        if (command.height === undefined) throw Error('Invalid toolbar height');
        if (this.toolbarHeight !== command.height) {
          this.toolbarHeight = command.height;
          this.layout();
        }
        return;
      case 'openBookmarkFolder': {
        if (
          !command.id ||
          !this.store.folders().some((folder) => folder.id === command.id)
        )
          throw Error('Folder not found');
        this.validateMenuPosition(command);
        this.popupBookmarkMenu(this.folderMenuItems(command.id), command);
        return;
      }
      case 'openBookmarkOverflow': {
        // The bar shows root bookmarks, then folders; `order` is how many fit.
        this.validateMenuPosition(command);
        const items: Electron.MenuItemConstructorOptions[] = [
          ...this.store
            .bookmarks()
            .filter((bookmark) => bookmark.folderId === null)
            .map((bookmark) =>
              this.bookmarkMenuItem(
                bookmark,
                (current) => current.folderId === null,
              ),
            ),
          ...this.store.folders().map((folder) => ({
            label: folder.title.replace(/&/g, '&&'),
            submenu: this.folderMenuItems(folder.id),
          })),
        ];
        if (command.order === undefined || command.order >= items.length)
          throw Error('Invalid overflow position');
        this.popupBookmarkMenu(items.slice(command.order), command);
        return;
      }
      case 'showBookmarks':
        this.overlay = 'bookmarks';
        this.layout();
        this.emit();
        return;
      case 'bookmarkFolders':
        return this.store.folders();
      case 'createFolder':
        if (!command.title) throw Error('Invalid name');
        return this.store.createFolder(command.title);
      case 'renameFolder':
        if (!command.id || !command.title) throw Error('Invalid folder');
        this.store.renameFolder(command.id, command.title, command.order);
        return;
      case 'removeFolder':
        if (!command.id) throw Error('Invalid folder');
        this.store.removeFolder(command.id);
        return;
      case 'updateBookmark':
        if (!command.url || !command.title || command.folderId === undefined)
          throw Error('Invalid bookmark');
        this.store.updateBookmark(
          parseAddress(command.url).display,
          command.title,
          command.folderId,
          command.order,
        );
        return;
      case 'showSettings':
        this.overlay = 'settings';
        this.layout();
        this.emit();
        return;
      case 'showSiteSettings':
        if (!tab?.state.url) throw Error(t('noTab'));
        this.overlay = 'site';
        this.layout();
        this.emit();
        return;
      case 'dismissOverlay':
        this.overlay = null;
        this.layout();
        this.emit();
        return;
      case 'siteCopySource': {
        const tab = this.scopedTab(command);
        const url = new URL(tab.view.webContents.getURL());
        url.hash = '';
        try {
          // Prefer the exact bytes the renderer received. Without them (custom
          // protocols, uncached responses) reread only what cannot change: a
          // local file or content-addressed IPFS/IPNS data. An HTTP(S) refetch
          // could return different content (e.g. after a POST), so serialize
          // the document that is on screen instead.
          let source = await renderedSource(tab.view.webContents);
          if (source === undefined && url.protocol === 'file:')
            source = await readLimitedFile(url);
          else if (source === undefined && url.protocol === 'p2p:') {
            const response = await this.session.fetch(url.href, {
              signal: AbortSignal.timeout(30000),
            });
            if (!response.ok) throw Error('HTTP ' + response.status);
            source = await readLimitedBody(response);
          } else if (source === undefined)
            source = await serializedDocument(tab.view.webContents);
          this.scopedTab(command);
          clipboard.writeText(source);
        } catch (error) {
          if (error instanceof SourceTooLargeError)
            throw Error(t('sourceTooLarge'));
          throw Error(t('sourceUnavailable'), { cause: error });
        }
        return;
      }
      case 'siteCopy':
      case 'siteBookmark': {
        const target = this.scopedTab(command);
        if (command.action === 'siteCopy')
          clipboard.writeText(target.state.url);
        else if (!canBookmark(target.state.url))
          throw Error(t('localBookmarkUnavailable'));
        else if (
          !this.store
            .bookmarks()
            .some((bookmark) => bookmark.url === target.state.url)
        )
          this.store.bookmark(target.state.url, target.state.title);
        return;
      }
      case 'siteInfo':
        return this.siteInfo(command);
      case 'setSitePreferences':
      case 'resetSitePreferences': {
        const target = this.scopedTab(command),
          scope = siteScope(target.state.url);
        const previous = sitePreferences(this.store, target.state.url);
        const next =
          command.action === 'resetSitePreferences'
            ? { zoom: 100, muted: false }
            : {
                zoom: command.zoom ?? previous.zoom,
                muted: command.muted ?? previous.muted,
              };
        if (
          !Number.isInteger(next.zoom) ||
          next.zoom < 50 ||
          next.zoom > 200 ||
          typeof next.muted !== 'boolean'
        )
          throw Error('Invalid site preferences');
        this.store.set(`site:${scope}`, next);
        for (const item of this.tabs)
          if (
            item.view &&
            item.state.url &&
            siteScope(item.state.url) === scope
          )
            this.applySitePreferences(item);
        return this.siteInfo(command);
      }
      case 'sitePin':
      case 'siteUnpin': {
        const info = await this.siteInfo(command);
        if (!info.cid || info.pinState === 'unavailable')
          throw Error(t('nodeNotReady'));
        this.scopedTab(command);
        if (command.action === 'sitePin') await this.engine.pin(info.cid);
        else await this.engine.unpin(info.cid);
        this.store.pin(info.cid, command.action === 'sitePin');
        return this.siteInfo(command);
      }
      case 'state':
        this.emit(true);
        return;
      case 'new':
        this.create(command.url);
        return;
      case 'navigate':
        if (!command.url) throw Error(t('invalidAddress'));
        this.load(tab || this.create(), command.url);
        return;
      case 'switch': {
        this.overlay = null;
        const selected = this.tabs.find((tab) => tab.state.id === command.id);
        if (selected) {
          this.select(selected);
          this.persist();
          this.emit();
        }
        return;
      }
      case 'close': {
        this.overlay = null;
        const i = this.tabs.findIndex(
          (t) => t.state.id === (command.id || this.active),
        );
        if (i < 0) return;
        const [t] = this.tabs.splice(i, 1);
        if (t.view) {
          this.window.contentView.removeChildView(t.view);
          t.view.webContents.close();
        }
        this.select(
          this.active === t.state.id
            ? this.tabs[Math.max(0, i - 1)]
            : this.current(),
        );
        this.persist();
        this.emit();
        return;
      }
      case 'back':
        if (tab?.view.webContents.navigationHistory.canGoBack())
          tab.view.webContents.navigationHistory.goBack();
        return;
      case 'forward':
        if (tab?.view.webContents.navigationHistory.canGoForward())
          tab.view.webContents.navigationHistory.goForward();
        return;
      case 'reload':
        tab?.view.webContents.reload();
        return;
      case 'stop':
        tab?.view.webContents.stop();
        return;
      case 'home':
        if (tab) tab.home = true;
        this.overlay = null;
        this.panel = true;
        this.layout();
        this.emit();
        return;
      case 'content':
        if (tab?.state.url) tab.home = false;
        this.overlay = null;
        this.panel = tab?.home ?? true;
        this.layout();
        this.emit();
        return;
      case 'copy':
        if (tab) clipboard.writeText(tab.state.url);
        return;
      case 'bookmark':
        if (tab?.state.url && !canBookmark(tab.state.url))
          throw Error(t('localBookmarkUnavailable'));
        if (
          tab?.state.url &&
          !this.store
            .bookmarks()
            .some((bookmark) => bookmark.url === tab.state.url)
        )
          this.store.bookmark(tab.state.url, tab.state.title);
        return;
      case 'removeBookmark':
        if (command.url)
          this.store.removeBookmark(parseAddress(command.url).display);
        return;
      case 'setLanguage':
        if (command.language === undefined) throw Error('Invalid language');
        this.languagePreference = command.language;
        this.store.set('language', command.language);
        setLocale(
          command.language === 'auto'
            ? resolveLanguage(this.preferredLanguages)
            : command.language,
        );
        for (const tab of this.tabs)
          if (!tab.state.url) tab.state.title = t('newTab');
        this.onLanguageChanged();
        this.emit();
        return;
      case 'settings':
        return {
          restoreTabs: this.store.get('restoreTabs', true),
          language: this.languagePreference,
          locale: getLocale(),
        };
      case 'toggleRestore':
        this.store.set('restoreTabs', !this.store.get('restoreTabs', true));
        return;
      case 'bookmarks':
        return this.store.bookmarks();
      case 'library':
        return {
          history: this.store.history(),
          bookmarks: this.store.bookmarks(),
        };
      case 'importFiles':
      case 'importDirectory': {
        if (this.importing) throw Error(t('importRunning'));
        if (this.engine.state !== 'ready') throw Error(t('nodeNotReady'));
        this.importing = true;
        try {
          const directory = command.action === 'importDirectory';
          const selection = await dialog.showOpenDialog(this.window, {
            title: directory ? t('importDirectory') : t('importFiles'),
            buttonLabel: t('importTitle'),
            properties: directory
              ? ['openDirectory']
              : ['openFile', 'multiSelections'],
          });
          if (selection.canceled || !selection.filePaths.length) return null;
          const result = await this.engine.importPaths(
            selection.filePaths,
            directory ? 'directory' : 'files',
          );
          if (this.window.isDestroyed()) return null;
          this.imported.add(result.url);
          for (const file of result.files) this.imported.add(file.url);
          this.pendingImport = { result, pinRecorded: false };
          return this.saveImported(result.url);
        } finally {
          this.importing = false;
        }
      }
      case 'retryImportSave':
        return this.saveImported(command.url);
      case 'copyImportFile':
      case 'copyImported':
        if (!command.url || !this.imported.has(command.url))
          throw Error(t('invalidImport'));
        clipboard.writeText(command.url);
        return;
      case 'restartNode': {
        if (this.engine.state === 'starting') throw Error(t('nodeStarting'));
        const restart = this.engine.restart();
        this.emit();
        try {
          await restart;
        } finally {
          this.emit();
        }
        return;
      }
      case 'clearBrowsingData': {
        const { response } = await dialog.showMessageBox(this.window, {
          type: 'warning',
          buttons: [t('clearData'), t('cancel')],
          defaultId: 1,
          cancelId: 1,
          message: t('clearDataConfirm'),
          detail: t('clearDataDetail'),
        });
        if (response !== 0) return false;
        this.store.clearHistory();
        await this.session.clearStorageData();
        await this.session.clearCache();
        await this.session.clearAuthCache();
        return true;
      }
      case 'stats':
        return {
          ...(await this.engine.getStats()),
          status: this.nodeLabel(),
          manualPins: this.store.pins(),
        };
      default:
        throw Error('Unknown command');
    }
  }
  private saveImported(url?: string): ImportResult {
    const pending = this.pendingImport;
    if (!pending || pending.result.url !== url) throw Error(t('invalidImport'));
    const { result } = pending;
    try {
      if (!pending.pinRecorded) {
        this.store.pin(result.cid, true);
        pending.pinRecorded = true;
      }
      this.store.bookmarkIPFS(result.url, result.names.join(', '));
      this.pendingImport = undefined;
      return result;
    } catch (error) {
      return { ...result, saveError: (error as Error).message };
    }
  }
  destroy() {
    this.favicons.stop();
    this.bookmarkMenu?.closePopup(this.window);
    this.bookmarkMenu = undefined;
    for (const t of this.tabs)
      if (t.view && !t.view.webContents.isDestroyed())
        t.view.webContents.close();
    this.tabs = [];
  }
}
