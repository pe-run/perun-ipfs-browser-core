import { siteIcon, setIconSources, refreshIcons } from './icons';
import './style.css';
import type { ImportResult } from '../main/ipfs/import';
import type {
  Command,
  BrowserState,
  SiteInfo,
  Bookmark,
  BookmarkFolder,
} from '../shared/types';
import {
  t,
  setLocale,
  getLocale,
  languageNames,
  type MessageKey,
  localizeMessage,
} from '../shared/i18n';
import {
  catalog,
  catalogCategories,
  catalogDescription,
  type CatalogCategory,
} from '../shared/catalog';
const api = window.browser;
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let userError = '',
  editingAddress = false,
  lastAddress = '',
  lastLocale = '';
let latestState: BrowserState | undefined;
let latestIconSources: Record<string, string[]> = {};
let site: SiteInfo | undefined,
  siteTarget = '',
  siteBusy = false,
  siteError = '';
let siteRequest = 0;
let bookmarks: Bookmark[] = [],
  folders: BookmarkFolder[] = [];
let bookmarkFilter = 'all',
  pendingBookmarkURL = '';
let details:
  | {
      kind: 'library';
      data: {
        history: { url: string; title: string }[];
        bookmarks: { url: string; title: string }[];
      };
    }
  | { kind: 'stats'; data: Record<string, unknown> }
  | { kind: 'loading' }
  | undefined;
let imported: ImportResult | null | undefined,
  importError = '',
  importBusy = false;
async function command(c: Command) {
  try {
    const result = await api.command(c);
    userError = '';
    $('message').textContent = '';
    if (['bookmark', 'siteBookmark', 'removeBookmark'].includes(c.action))
      void refreshBookmarks();
    return result;
  } catch (e) {
    userError = localizeMessage((e as Error).message);
    $('message').textContent = userError;
  }
}
function button(text: string, action: () => void, title = '') {
  const b = document.createElement('button');
  b.textContent = text;
  b.title = title;
  b.onclick = action;
  return b;
}
function translateStatic() {
  document.documentElement.lang = getLocale();
  for (const [attribute, property] of [
    ['data-i18n', 'textContent'],
    ['data-i18n-title', 'title'],
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-label', 'aria-label'],
  ] as const) {
    for (const element of document.querySelectorAll<HTMLElement>(
      `[${attribute}]`,
    )) {
      const value = t(element.getAttribute(attribute) as MessageKey);
      if (property === 'textContent') element.textContent = value;
      else element.setAttribute(property, value);
    }
  }
  const selector = $<HTMLSelectElement>('language'),
    selected = selector.value;
  selector.replaceChildren(
    new Option(t('auto'), 'auto'),
    ...Object.entries(languageNames).map(
      ([code, name]) => new Option(name, code),
    ),
  );
  selector.value = selected || 'auto';
  renderBookmarks();
  renderCatalog();
  renderDetails();
  renderImport();
  renderSite();
}
const categoryLabels: Record<CatalogCategory, MessageKey> = {
  documentation: 'categoryDocumentation',
  browsers: 'categoryBrowsers',
  directories: 'categoryDirectories',
  knowledge: 'categoryKnowledge',
  technology: 'categoryTechnology',
  applications: 'categoryApplications',
  defi: 'categoryDefi',
  archives: 'categoryArchives',
  culture: 'categoryCulture',
  blogs: 'categoryBlogs',
  graphics: 'categoryGraphics',
  radio: 'categoryRadio',
  organizations: 'categoryOrganizations',
  tools: 'categoryTools',
  events: 'categoryEvents',
  previous: 'categoryPrevious',
  infrastructure: 'categoryInfrastructure',
};
const statusLabels = {
  manifest: 'statusManifest',
  reference: 'statusReference',
  index: 'statusIndex',
  previous: 'statusPrevious',
} as const;
function updateBookmarkStar() {
  const active = latestState?.tabs.find(
    (tab) => tab.id === latestState?.active,
  );
  const saved =
    !!active?.url && bookmarks.some((bookmark) => bookmark.url === active.url);
  const star = $<HTMLButtonElement>('bookmark');
  star.disabled = !active?.url;
  star.textContent = saved ? '★' : '☆';
  star.setAttribute('aria-pressed', String(saved));
  star.title = t(saved ? 'bookmarkSaved' : 'bookmark');
}
function bookmarkLink(bookmark: Bookmark, start: boolean) {
  const link = document.createElement('a');
  link.href = bookmark.url;
  const label = document.createElement('span');
  label.textContent = bookmark.title || bookmark.url;
  link.append(siteIcon(bookmark.url, api), label);
  link.title = bookmark.description
    ? bookmark.description + '\n' + bookmark.url
    : bookmark.url;
  link.onclick = (event) => {
    event.preventDefault();
    void command({
      action: start || event.ctrlKey || event.metaKey ? 'new' : 'navigate',
      url: bookmark.url,
    });
  };
  link.onauxclick = (event) => {
    if (event.button === 1) {
      event.preventDefault();
      void command({ action: 'new', url: bookmark.url });
    }
  };
  link.oncontextmenu = (event) => {
    event.preventDefault();
    pendingBookmarkURL = bookmark.url;
    bookmarkFilter = 'all';
    renderBookmarkManager();
    void command({ action: 'showBookmarks' });
  };
  return link;
}
function renderBookmarks() {
  const links = $('start-bookmarks-links'),
    bar = $('bookmarks-bar');
  links.replaceChildren();
  bar.replaceChildren();
  $('start-bookmarks').hidden = bookmarks.length === 0;
  const manage = button(
    '☰',
    () => {
      bookmarkFilter = 'all';
      renderBookmarkManager();
      void command({ action: 'showBookmarks' });
    },
    t('manageBookmarks'),
  );
  manage.id = 'manage-bookmarks';
  manage.setAttribute('aria-label', t('manageBookmarks'));
  bar.append(manage);
  const grouped = Map.groupBy(bookmarks, (bookmark) => bookmark.folderId);
  for (const bookmark of grouped.get(null) ?? []) {
    links.append(bookmarkLink(bookmark, true));
    bar.append(bookmarkLink(bookmark, false));
  }
  for (const folder of folders) {
    for (const bookmark of grouped.get(folder.id) ?? [])
      links.append(bookmarkLink(bookmark, true));
    const entry = button('📁 ' + folder.title, () => {
      const bounds = entry.getBoundingClientRect();
      void command({
        action: 'openBookmarkFolder',
        id: folder.id,
        x: Math.max(0, Math.floor(bounds.left)),
        y: Math.ceil(bounds.bottom),
      });
    });
    entry.setAttribute('aria-haspopup', 'menu');
    entry.onkeydown = (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        entry.click();
      }
    };
    entry.dataset.folderId = String(folder.id);
    bar.append(entry);
  }
  const more = button(
    '»',
    () => {
      const bounds = more.getBoundingClientRect();
      void command({
        action: 'openBookmarkOverflow',
        order: visibleBarEntries,
        x: Math.max(0, Math.floor(bounds.left)),
        y: Math.ceil(bounds.bottom),
      });
    },
    t('moreBookmarks'),
  );
  more.id = 'bookmarks-overflow';
  more.setAttribute('aria-label', t('moreBookmarks'));
  more.setAttribute('aria-haspopup', 'menu');
  bar.append(more);
  fitBookmarksBar();
  updateBookmarkStar();
  renderBookmarkManager();
}
/** Number of bar entries (root bookmarks, then folders) currently shown. */
let visibleBarEntries = 0;
/** Hide entries that do not fit; the » button lists them in a native menu. */
function fitBookmarksBar() {
  const bar = $('bookmarks-bar'),
    more = document.getElementById('bookmarks-overflow');
  if (!more) return;
  const entries = Array.from(
    bar.querySelectorAll<HTMLElement>(':scope > a, :scope > [data-folder-id]'),
  );
  for (const entry of entries) entry.hidden = false;
  more.hidden = true;
  visibleBarEntries = entries.length;
  if (bar.scrollWidth <= bar.clientWidth) return;
  more.hidden = false;
  const limit = bar.clientWidth - more.offsetWidth - 6;
  const first = entries.findIndex(
    (entry) => entry.offsetLeft + entry.offsetWidth > limit,
  );
  visibleBarEntries = first < 0 ? entries.length : first;
  for (const entry of entries.slice(visibleBarEntries)) entry.hidden = true;
}
new ResizeObserver(() => fitBookmarksBar()).observe($('bookmarks-bar'));
async function refreshBookmarks() {
  try {
    [bookmarks, folders] = (await Promise.all([
      api.command({ action: 'bookmarks' }),
      api.command({ action: 'bookmarkFolders' }),
    ])) as [Bookmark[], BookmarkFolder[]];
    renderBookmarks();
  } catch (e) {
    $('message').textContent = localizeMessage((e as Error).message);
  }
}
async function bookmarkMutation(c: Command) {
  try {
    await api.command(c);
    $('bookmark-error').textContent = '';
    await refreshBookmarks();
  } catch (e) {
    $('bookmark-error').textContent = localizeMessage((e as Error).message);
  }
}
function folderOptions(select: HTMLSelectElement, value: string, all = false) {
  select.replaceChildren(
    ...(all ? [new Option(t('allBookmarks'), 'all')] : []),
    new Option(t('bookmarksBar'), 'root'),
    ...folders.map((folder) => new Option(folder.title, String(folder.id))),
  );
  select.value = value;
  if (!select.value) select.value = all ? 'all' : 'root';
}
function renderBookmarkManager() {
  const filter = $<HTMLSelectElement>('bookmark-folder-filter');
  folderOptions(filter, bookmarkFilter, true);
  bookmarkFilter = filter.value;
  const folder = folders.find((folder) => String(folder.id) === bookmarkFilter);
  $('bookmark-folder-edit').hidden = !folder;
  $('folder-delete-note').hidden = !folder;
  $<HTMLInputElement>('folder-title').value = folder?.title || '';
  const folderOrder = $<HTMLInputElement>('folder-order');
  folderOrder.max = String(folders.length);
  folderOrder.value = String((folder?.order ?? 0) + 1);
  folderOrder.defaultValue = folderOrder.value;
  const list = $('bookmark-manager-list');
  list.replaceChildren();
  for (const bookmark of bookmarks) {
    if (
      bookmarkFilter !== 'all' &&
      (bookmarkFilter === 'root'
        ? bookmark.folderId !== null
        : String(bookmark.folderId) !== bookmarkFilter &&
          String(bookmark.shortcutFolderId) !== bookmarkFilter)
    )
      continue;
    const row = document.createElement('form');
    row.dataset.url = bookmark.url;
    row.className = 'bookmark-editor';
    const link = bookmarkLink(bookmark, false),
      title = document.createElement('input'),
      position = document.createElement('input'),
      target = document.createElement('select'),
      save = document.createElement('button');
    title.value = bookmark.title;
    title.required = true;
    title.maxLength = 200;
    title.setAttribute('aria-label', t('bookmarkName'));
    target.setAttribute('aria-label', t('folder'));
    position.type = 'number';
    position.min = '1';
    position.max = String(
      bookmarks.filter((other) => other.folderId === bookmark.folderId).length,
    );
    position.value = position.defaultValue = String((bookmark.order ?? 0) + 1);
    position.required = true;
    position.className = 'bookmark-position';
    position.setAttribute('aria-label', t('position'));
    position.title = t('position');
    folderOptions(
      target,
      bookmark.folderId === null ? 'root' : String(bookmark.folderId),
    );
    save.textContent = t('save');
    save.type = 'submit';
    const remove = button(
      t('remove'),
      () =>
        void bookmarkMutation({ action: 'removeBookmark', url: bookmark.url }),
    );
    remove.type = 'button';
    row.onsubmit = (event) => {
      event.preventDefault();
      void bookmarkMutation({
        action: 'updateBookmark',
        url: bookmark.url,
        title: title.value,
        folderId: target.value === 'root' ? null : Number(target.value),
        // Without an explicit position, a bookmark moved to another folder goes first.
        ...(position.value !== position.defaultValue
          ? { order: Math.max(0, Number(position.value) - 1) }
          : {}),
      });
    };
    row.append(link, title, target, position, save, remove);
    list.append(row);
  }
}
function renderCatalog() {
  const cards = $('catalog-links'),
    selector = $<HTMLSelectElement>('catalog-category'),
    selected = selector.value || 'all',
    visibleCategories = catalogCategories.filter((category) =>
      catalog.some((entry) => entry.category === category),
    );
  selector.replaceChildren(
    new Option(`${t('catalogAll')} (${catalog.length})`, 'all'),
    ...visibleCategories.map(
      (category) =>
        new Option(
          `${t(categoryLabels[category])} (${catalog.filter((entry) => entry.category === category).length})`,
          category,
        ),
    ),
  );
  selector.value = selected;
  cards.replaceChildren();
  for (const category of visibleCategories) {
    if (selected !== 'all' && selected !== category) continue;
    const entries = catalog.filter((entry) => entry.category === category),
      section = document.createElement('section'),
      heading = document.createElement('h3'),
      grid = document.createElement('div');
    section.className = 'catalog-group';
    section.dataset.category = category;
    heading.textContent = `${t(categoryLabels[category])} (${entries.length})`;
    grid.className = 'catalog-grid';
    for (const entry of entries) {
      const article = document.createElement('article');
      article.className = 'catalog-card';
      const link = document.createElement('a');
      link.href = entry.url;
      link.append(
        siteIcon(entry.url, api),
        document.createTextNode(entry.titles?.[getLocale()] || entry.title),
      );
      link.title = entry.url;
      link.onclick = (event) => {
        event.preventDefault();
        void command({ action: 'new', url: entry.url });
      };
      link.onauxclick = (event) => {
        if (event.button === 1) {
          event.preventDefault();
          void command({ action: 'new', url: entry.url });
        }
      };
      const description = document.createElement('p');
      description.className = 'catalog-description';
      description.textContent = catalogDescription(entry, getLocale());
      description.lang = entry.descriptions[getLocale()] ? getLocale() : 'en';
      article.append(link, description);
      if (entry.domain) {
        const domain = document.createElement('p');
        domain.className = 'catalog-domain';
        domain.textContent = t('catalogDomain', { domain: entry.domain });
        article.append(domain);
      }
      const status = document.createElement('p');
      status.className = 'catalog-status';
      status.textContent = t(statusLabels[entry.status]);
      article.append(status);
      grid.append(article);
    }
    section.append(heading, grid);
    cards.append(section);
  }
}

function renderDetails() {
  const body = $('details');
  body.replaceChildren();
  if (!details) return;
  if (details.kind === 'loading') {
    body.textContent = t('loadingStats');
    return;
  }
  if (details.kind === 'library') {
    for (const [key, rows] of [
      ['bookmarks', details.data.bookmarks],
      ['history', details.data.history],
    ] as const) {
      const h = document.createElement('h2');
      h.textContent = t(key);
      body.append(h);
      for (const row of rows) {
        const p = document.createElement('p');
        p.append(
          button(
            row.title || row.url,
            () => void command({ action: 'navigate', url: row.url }),
          ),
        );
        const url = document.createElement('small');
        url.textContent = row.url;
        p.append(url);
        if (key === 'bookmarks')
          p.append(
            button(t('remove'), () => {
              void command({ action: 'removeBookmark', url: row.url }).then(
                () => $('library').click(),
              );
            }),
          );
        body.append(p);
      }
    }
    return;
  }
  const labels = {
    peerID: 'statPeer',
    peers: 'statPeers',
    repoBytes: 'statRepo',
    totalIn: 'statIn',
    totalOut: 'statOut',
    pins: 'statPins',
    manualPins: 'statManual',
  } as const;
  const list = document.createElement('dl');
  for (const [key, label] of Object.entries(labels)) {
    const dt = document.createElement('dt');
    dt.textContent = t(label);
    const dd = document.createElement('dd');
    const value = details.data[key];
    dd.textContent =
      value === null || value === undefined
        ? t('notAvailable')
        : Array.isArray(value)
          ? value.join('\n') || '0'
          : String(value);
    list.append(dt, dd);
  }
  body.append(list);
  if (details.data.peers === 0) {
    const note = document.createElement('p');
    note.textContent = t('noPeers');
    body.append(note);
  }
}
function renderImport() {
  const result = $('importResult');
  result.replaceChildren();
  for (const id of ['importFiles', 'importDirectory'])
    $<HTMLButtonElement>(id).disabled = importBusy;
  if (importBusy) {
    result.textContent = t('importBusy');
    return;
  }
  if (importError) {
    result.textContent = t('importFailed', {
      error: localizeMessage(importError),
    });
    return;
  }
  if (imported === null) {
    result.textContent = t('canceled');
    return;
  }
  if (!imported) return;
  const value = imported,
    text = document.createElement('p'),
    url = document.createElement('code');
  text.textContent = value.saveError
    ? t('importSaveFailed', { error: value.saveError })
    : t('importSuccess', { names: value.names.join(', ') });
  url.textContent = value.url;
  result.append(
    text,
    url,
    button(
      t('copyIPFS'),
      () => void command({ action: 'copyImported', url: value.url }),
    ),
    button(t('openNew'), () => void command({ action: 'new', url: value.url })),
  );
  if (value.saveError)
    result.append(
      button(t('save'), async () => {
        const updated = await command({
          action: 'retryImportSave',
          url: value.url,
        });
        if (updated && imported === value) {
          imported = updated as ImportResult;
          renderImport();
          void refreshBookmarks();
        }
      }),
    );
  for (const file of value.files) {
    const row = document.createElement('p');
    row.append(
      button(
        t('openFile', { name: file.name }),
        () => void command({ action: 'new', url: file.url }),
      ),
      button(
        t('copyFile', { name: file.name }),
        () => void command({ action: 'copyImportFile', url: file.url }),
      ),
    );
    result.append(row);
  }
}
function renderSite() {
  const target = latestState?.tabs.find(
    (tab) => tab.id === latestState?.active,
  );
  $('site-url').textContent = site?.url || target?.url || '';
  $('site-error').textContent = siteError;
  const ipfs = Boolean(site && ['ipfs', 'ipns'].includes(site.kind));
  $('site-ipfs').hidden = !ipfs;
  $('site-shared-warning').hidden = !ipfs;
  $('site-cid').textContent = site?.cid || '';
  $('site-pin-state').textContent = site
    ? t(
        site.pinState === 'pinned'
          ? 'pinned'
          : site.pinState === 'unpinned'
            ? 'unpinned'
            : 'notAvailable',
      )
    : '';
  $<HTMLButtonElement>('pin').disabled =
    siteBusy || !site || site.pinState !== 'unpinned';
  $<HTMLButtonElement>('unpin').disabled =
    siteBusy || !site || site.pinState !== 'pinned';
  for (const id of [
    'site-zoom',
    'site-muted',
    'site-reset',
    'site-copy',
    'site-copy-source',
    'site-bookmark',
  ])
    $<HTMLInputElement>(id).disabled = siteBusy || !site;
  if (site && !siteBusy) {
    $<HTMLSelectElement>('site-zoom').value = String(site.zoom);
    $<HTMLInputElement>('site-muted').checked = site.muted;
  }
}
async function refreshSite() {
  const tab = latestState?.tabs.find((tab) => tab.id === latestState?.active);
  if (!tab?.url) return;
  const request = ++siteRequest;
  site = undefined;
  siteBusy = true;
  siteError = '';
  renderSite();
  try {
    const value = (await api.command({
      action: 'siteInfo',
      id: tab.id,
      url: tab.url,
    })) as SiteInfo;
    if (request === siteRequest) site = value;
  } catch (e) {
    if (request === siteRequest)
      siteError = localizeMessage((e as Error).message);
  } finally {
    if (request === siteRequest) {
      siteBusy = false;
      renderSite();
    }
  }
}
async function siteCommand(action: string, values: Partial<Command> = {}) {
  if (!site || siteBusy) return;
  const target = site;
  siteBusy = true;
  siteError = '';
  renderSite();
  try {
    if (['siteCopy', 'siteCopySource', 'siteBookmark'].includes(action)) {
      await api.command({ action, id: target.id, url: target.url });
      if (action === 'siteCopySource') siteError = t('sourceCopied');
      if (action === 'siteBookmark') void refreshBookmarks();
    } else
      site = (await api.command({
        action,
        id: target.id,
        url: target.url,
        ...values,
      })) as SiteInfo;
  } catch (e) {
    siteError = localizeMessage((e as Error).message);
  } finally {
    siteBusy = false;
    renderSite();
  }
}
function renderOverlay(s: BrowserState) {
  for (const [id, kind] of [
    ['settings-dialog', 'settings'],
    ['site-dialog', 'site'],
    ['bookmarks-dialog', 'bookmarks'],
  ] as const) {
    const dialog = $<HTMLDialogElement>(id);
    if (s.overlay === kind) {
      if (!dialog.open) {
        dialog.showModal();
        if (kind === 'bookmarks' && pendingBookmarkURL) {
          const row = Array.from(
            $('bookmark-manager-list').querySelectorAll('form'),
          ).find((row) => row.dataset.url === pendingBookmarkURL);
          const input = row?.querySelector('input');
          input?.focus();
          input?.select();
          pendingBookmarkURL = '';
        }
      }
    } else if (dialog.open) dialog.close();
  }
  const tab = s.tabs.find((tab) => tab.id === s.active),
    target = `${tab?.id}:${tab?.url}`;
  if (s.overlay === 'site' && siteTarget !== target) {
    siteTarget = target;
    void refreshSite();
  }
  if (s.overlay !== 'site') {
    siteTarget = '';
    siteRequest++;
  }
}
function renderState(s: BrowserState) {
  latestState = s;
  const iconSourcesChanged =
    JSON.stringify(s.faviconSources) !== JSON.stringify(latestIconSources);
  setIconSources(s.faviconSources);
  latestIconSources = s.faviconSources;
  if (iconSourcesChanged) refreshIcons(api);
  setLocale(s.locale);
  if (lastLocale !== s.locale) {
    lastLocale = s.locale;
    translateStatic();
  }
  $('app-version').textContent = t('version', { version: s.version });
  $<HTMLSelectElement>('language').value = s.languagePreference;
  const tabs = $('tabs');
  tabs.replaceChildren();
  for (const tab of s.tabs) {
    const item = document.createElement('span');
    item.className = tab.id === s.active ? 'tab active' : 'tab';
    item.append(
      button(
        (tab.loading ? '◌ ' : '') + tab.title.slice(0, 28),
        () => void command({ action: 'switch', id: tab.id }),
      ),
      button(
        '×',
        () => void command({ action: 'close', id: tab.id }),
        t('close'),
      ),
    );
    item.querySelector('button')!.prepend(siteIcon(tab.url, api));
    tabs.append(item);
  }
  const tab = s.tabs.find((tab) => tab.id === s.active),
    input = $<HTMLInputElement>('address'),
    url = tab?.url || '';
  if (!editingAddress || url !== lastAddress) input.value = url;
  // The address background doubles as an (indeterminate) progress bar.
  input.classList.toggle('loading', !!tab?.loading);
  input.setAttribute('aria-busy', String(!!tab?.loading));
  lastAddress = url;
  $<HTMLButtonElement>('back').disabled = !tab?.back;
  $<HTMLButtonElement>('forward').disabled = !tab?.forward;
  $('node').textContent = `IPFS: ${s.node}`;
  $('restart-node').hidden = !['failed', 'crashed', 'stopped'].includes(
    s.nodeState,
  );
  $('message').textContent = tab?.error || userError;
  $('panel').hidden = !s.panel;
  updateBookmarkStar();
  $<HTMLButtonElement>('site-settings').disabled = !tab?.url;
  renderOverlay(s);
}
api.onState(renderState);
api.onTitle((title) => {
  $('window-title').textContent = title;
});
$<HTMLInputElement>('address').addEventListener('input', () => {
  editingAddress = true;
});
$<HTMLInputElement>('address').addEventListener('blur', () => {
  editingAddress = false;
});
$('navigate').onsubmit = (e) => {
  e.preventDefault();
  editingAddress = false;
  void command({
    action: 'navigate',
    url: $<HTMLInputElement>('address').value,
  });
};
for (const action of [
  'new',
  'back',
  'forward',
  'reload',
  'stop',
  'home',
  'bookmark',
  'copy',
  'content',
])
  $(action).onclick = () => void command({ action });
$('library').onclick = async () => {
  await command({ action: 'home' });
  const data = await command({ action: 'library' });
  if (data) {
    details = {
      kind: 'library',
      data: data as Extract<
        NonNullable<typeof details>,
        { kind: 'library' }
      >['data'],
    };
    renderDetails();
    $('details').scrollIntoView({ block: 'start' });
  }
};
$('stats').onclick = async () => {
  await command({ action: 'home' });
  details = { kind: 'loading' };
  renderDetails();
  const data = await command({ action: 'stats' });
  details = data
    ? { kind: 'stats', data: data as Record<string, unknown> }
    : undefined;
  renderDetails();
  $('details').scrollIntoView({ block: 'start' });
  if (!data) $('details').textContent = t('nodeUnavailable');
};
$('restore').onchange = () => void command({ action: 'toggleRestore' });
$('restart-node').onclick = async () => {
  const restart = $<HTMLButtonElement>('restart-node');
  restart.disabled = true;
  try {
    await command({ action: 'restartNode' });
  } finally {
    restart.disabled = false;
  }
};
$('clear-data').onclick = async () => {
  $('clear-data-status').textContent = '';
  if ((await command({ action: 'clearBrowsingData' })) === true) {
    $('clear-data-status').textContent = t('clearDataDone');
    details = undefined;
    renderDetails();
  }
};
$('language').onchange = () => {
  void command({
    action: 'setLanguage',
    language: $<HTMLSelectElement>('language').value as Command['language'],
  });
};
for (const action of ['importFiles', 'importDirectory'])
  $(action).onclick = async () => {
    importBusy = true;
    importError = '';
    renderImport();
    try {
      imported = (await api.command({ action })) as ImportResult | null;
      if (imported) void refreshBookmarks();
    } catch (e) {
      imported = undefined;
      importError = (e as Error).message;
    } finally {
      importBusy = false;
      renderImport();
    }
  };
api.onFocusAddress(() => {
  $<HTMLInputElement>('address').focus();
  $<HTMLInputElement>('address').select();
});
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'l') {
    e.preventDefault();
    $<HTMLInputElement>('address').focus();
    $<HTMLInputElement>('address').select();
  }
  if (e.ctrlKey && e.key === 't') {
    e.preventDefault();
    void command({ action: 'new' });
  }
});
translateStatic();
void command({ action: 'settings' }).then((s) => {
  if (s)
    $<HTMLInputElement>('restore').checked = (
      s as { restoreTabs: boolean }
    ).restoreTabs;
});
void command({ action: 'state' });

$('home').onclick = () => {
  void command({ action: 'home' }).then(() => $('panel').scrollTo({ top: 0 }));
};

$('settings').onclick = () => void command({ action: 'showSettings' });
$('site-settings').onclick = () => void command({ action: 'showSiteSettings' });
for (const element of document.querySelectorAll<HTMLButtonElement>(
  '[data-dismiss]',
))
  element.onclick = () => void command({ action: 'dismissOverlay' });
for (const id of ['settings-dialog', 'site-dialog', 'bookmarks-dialog'])
  $<HTMLDialogElement>(id).oncancel = (e) => {
    e.preventDefault();
    void command({ action: 'dismissOverlay' });
  };
$('site-zoom').onchange = () =>
  void siteCommand('setSitePreferences', {
    zoom: Number($<HTMLSelectElement>('site-zoom').value),
  });
$('site-muted').onchange = () =>
  void siteCommand('setSitePreferences', {
    muted: $<HTMLInputElement>('site-muted').checked,
  });
$('site-reset').onclick = () => void siteCommand('resetSitePreferences');
$('pin').onclick = () => void siteCommand('sitePin');
$('unpin').onclick = () => void siteCommand('siteUnpin');
$('site-copy-source').onclick = () => void siteCommand('siteCopySource');
$('site-copy').onclick = () => void siteCommand('siteCopy');
$('site-bookmark').onclick = () => void siteCommand('siteBookmark');

$('catalog-category').onchange = () => renderCatalog();

void refreshBookmarks();

$('bookmark-folder-filter').onchange = () => {
  bookmarkFilter = $<HTMLSelectElement>('bookmark-folder-filter').value;
  renderBookmarkManager();
};
$('bookmark-new-folder').onsubmit = (event) => {
  event.preventDefault();
  const input = $<HTMLInputElement>('new-folder-title');
  void bookmarkMutation({ action: 'createFolder', title: input.value }).then(
    () => {
      input.value = '';
    },
  );
};
$('bookmark-folder-edit').onsubmit = (event) => {
  event.preventDefault();
  const order = $<HTMLInputElement>('folder-order');
  void bookmarkMutation({
    action: 'renameFolder',
    id: Number(bookmarkFilter),
    title: $<HTMLInputElement>('folder-title').value,
    ...(order.value !== order.defaultValue
      ? { order: Math.max(0, Number(order.value) - 1) }
      : {}),
  });
};
$('remove-folder').onclick = () =>
  void bookmarkMutation({ action: 'removeFolder', id: Number(bookmarkFilter) });
const toolbarObserver = new ResizeObserver(() => {
  const height = Math.ceil(
    document.querySelector('header')!.getBoundingClientRect().bottom,
  );
  document.documentElement.style.setProperty('--toolbar-height', `${height}px`);
  if (height >= 80 && height <= 240)
    void api.command({ action: 'setToolbarHeight', height }).catch(() => {});
});
toolbarObserver.observe(document.querySelector('header')!);
toolbarObserver.observe(document.querySelector('.window-titlebar')!);
