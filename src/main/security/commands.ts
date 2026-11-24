import { isLanguage } from '../../shared/i18n';
import type { Command } from '../../shared/types';

/**
 * Shape validation for commands from the browser chrome. Each action lists the
 * fields it accepts and each field has one validator; the controller still
 * checks meaning (an existing folder, the current tab, window bounds).
 */
type Check = (value: unknown) => boolean;
type Field = Exclude<keyof Command, 'action'>;

const integer =
  (min: number, max: number): Check =>
  (value) =>
    Number.isSafeInteger(value) &&
    (value as number) >= min &&
    (value as number) <= max;
const text =
  (max: number): Check =>
  (value) =>
    typeof value === 'string' && value.length <= max;
const name: Check = (value) =>
  typeof value === 'string' &&
  value.trim() !== '' &&
  value.length <= 200 &&
  !Array.from(value).some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );

const fields: Record<Field, Check> = {
  url: text(8192),
  id: integer(1, Number.MAX_SAFE_INTEGER),
  title: name,
  order: integer(0, 50000),
  folderId: (value) =>
    value === null || integer(1, Number.MAX_SAFE_INTEGER)(value),
  x: integer(0, 10000),
  y: integer(0, 10000),
  height: integer(80, 240),
  zoom: integer(50, 200),
  muted: (value) => typeof value === 'boolean',
  language: (value) => value === 'auto' || isLanguage(value),
  image: text(32768),
  sourceKey: text(40000),
};

/** Commands scoped to the page the user is looking at (tab id + public URL). */
const page: readonly Field[] = ['id', 'url'];
const actions: Record<string, readonly Field[]> = {
  // Tabs and navigation
  new: ['url'],
  navigate: ['url'],
  switch: ['id'],
  close: ['id'],
  back: [],
  forward: [],
  reload: [],
  stop: [],
  home: [],
  content: [],
  copy: [],
  state: [],
  // Interface
  setToolbarHeight: ['height'],
  showSettings: [],
  showSiteSettings: [],
  showBookmarks: [],
  dismissOverlay: [],
  settings: [],
  toggleRestore: [],
  setLanguage: ['language'],
  getFavicon: ['url'],
  saveFavicon: ['url', 'image', 'sourceKey'],
  // Bookmarks and history
  bookmark: [],
  bookmarks: [],
  bookmarkFolders: [],
  library: [],
  removeBookmark: ['url'],
  updateBookmark: ['url', 'title', 'folderId', 'order'],
  createFolder: ['title'],
  renameFolder: ['id', 'title', 'order'],
  removeFolder: ['id'],
  openBookmarkFolder: ['id', 'x', 'y'],
  openBookmarkOverflow: ['order', 'x', 'y'],
  clearBrowsingData: [],
  // Current page
  siteInfo: page,
  siteCopy: page,
  siteCopySource: page,
  siteBookmark: page,
  sitePin: page,
  siteUnpin: page,
  resetSitePreferences: page,
  setSitePreferences: [...page, 'zoom', 'muted'],
  // IPFS
  importFiles: [],
  importDirectory: [],
  retryImportSave: ['url'],
  copyImportFile: ['url'],
  copyImported: ['url'],
  stats: [],
  restartNode: [],
};

export function parseCommand(raw: unknown): Command {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw Error('Invalid command');
  const command = raw as Record<string, unknown>;
  const allowed =
    typeof command.action === 'string' && Object.hasOwn(actions, command.action)
      ? actions[command.action]
      : undefined;
  if (!allowed) throw Error('Invalid command');
  for (const [key, value] of Object.entries(command)) {
    if (key === 'action' || value === undefined) continue;
    if (!allowed.includes(key as Field) || !fields[key as Field](value))
      throw Error('Invalid arguments');
  }
  return command as unknown as Command;
}
