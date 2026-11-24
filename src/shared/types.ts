import type { Language, LanguagePreference } from './i18n';
export type NodeState = 'stopped' | 'starting' | 'ready' | 'failed' | 'crashed';
export interface TabState {
  id: number;
  url: string;
  title: string;
  loading: boolean;
  back: boolean;
  forward: boolean;
  error?: string;
}
export interface BrowserState {
  version: string;
  faviconSources: Record<string, string[]>;
  tabs: TabState[];
  active: number;
  panel: boolean;
  overlay: 'settings' | 'site' | 'bookmarks' | null;
  node: string;
  nodeState: NodeState;
  locale: Language;
  languagePreference: LanguagePreference;
}
export type Command = {
  action: string;
  id?: number;
  url?: string;
  language?: LanguagePreference;
  zoom?: number;
  muted?: boolean;
  title?: string;
  folderId?: number | null;
  /** Zero-based position within the bookmark list or the folder list. */
  order?: number;
  height?: number;
  x?: number;
  y?: number;
  image?: string;
  sourceKey?: string;
};
export interface BrowserAPI {
  onFocusAddress(callback: () => void): void;
  command(command: Command): Promise<unknown>;
  onTitle(callback: (title: string) => void): void;
  onState(callback: (state: BrowserState) => void): void;
}
declare global {
  interface Window {
    browser: BrowserAPI;
  }
}

export interface SiteInfo {
  id: number;
  url: string;
  scope: string;
  kind: 'http' | 'https' | 'ipfs' | 'ipns' | 'file';
  zoom: number;
  muted: boolean;
  cid?: string;
  pinState: 'pinned' | 'unpinned' | 'unavailable';
}

export interface Bookmark {
  url: string;
  description?: string;
  shortcutFolderId?: number;
  title: string;
  folderId: number | null;
  /** Position among bookmarks with the same folderId; assigned on load. */
  order?: number;
}
export interface BookmarkFolder {
  id: number;
  title: string;
  /** Position on the bookmarks bar; assigned on load. */
  order?: number;
}
