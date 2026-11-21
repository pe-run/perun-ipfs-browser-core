import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { parseAddress } from '../../shared/address';
import {
  starterBookmarks,
  starterFolders,
} from '../../shared/starter-bookmarks';
import type { Bookmark, BookmarkFolder } from '../../shared/types';
export interface BookmarksDocument {
  version: 1;
  bookmarks: Bookmark[];
  folders: BookmarkFolder[];
}
const defaults = (): BookmarksDocument => ({
  version: 1,
  bookmarks: starterBookmarks,
  folders: starterFolders,
});
// Pre-order files listed folders alphabetically with these two first.
const legacyPinned = ['Search', 'Community'];
const legacyFolderRank = (folders: BookmarkFolder[]) =>
  [
    ...legacyPinned.flatMap((title) =>
      folders.filter((folder) => folder.title === title),
    ),
    ...folders
      .filter((folder) => !legacyPinned.includes(folder.title))
      .sort((a, b) => a.title.localeCompare(b.title)),
  ].map((folder) => folder.id);
/** Sort by the order field (ties keep their current place) and renumber from 0. */
function renumber<T extends { order?: number }>(
  items: T[],
  fallback: (item: T, index: number) => number,
) {
  items
    .map((item, index) => ({
      item,
      index,
      key: item.order ?? fallback(item, index),
    }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .forEach(({ item }, order) => {
      item.order = order;
    });
}
/** Put item at a zero-based position among its siblings and renumber them. */
function place<T extends { order?: number }>(
  siblings: T[],
  item: T,
  position: number,
) {
  const list = siblings
    .filter((sibling) => sibling !== item)
    .sort((a, b) => a.order! - b.order!);
  list.splice(Math.min(Math.max(position, 0), list.length), 0, item);
  list.forEach((sibling, order) => {
    sibling.order = order;
  });
}
const validOrder = (order: unknown) =>
  order === undefined || Number.isSafeInteger(order);
const validPosition = (position: number | undefined) =>
  position === undefined || (Number.isSafeInteger(position) && position >= 0);
export class BookmarksFile {
  private data: BookmarksDocument;
  constructor(readonly file?: string) {
    try {
      if (file && existsSync(file)) {
        if (statSync(file).size > 16 * 1024 * 1024)
          throw Error('File exceeds 16 MiB');
        this.data = this.validate(JSON.parse(readFileSync(file, 'utf8')));
      } else {
        this.data = this.validate(defaults());
        this.write(this.data);
      }
    } catch (error) {
      throw Error(
        `Cannot load bookmarks${file ? ` (${file})` : ''}: ${(error as Error).message}`,
      );
    }
  }
  private validate(value: unknown): BookmarksDocument {
    if (!value || typeof value !== 'object')
      throw Error('Invalid JSON document');
    const data = value as BookmarksDocument;
    if (
      data.version !== 1 ||
      !Array.isArray(data.bookmarks) ||
      !Array.isArray(data.folders) ||
      data.bookmarks.length > 50000 ||
      data.folders.length > 50000
    )
      throw Error('Invalid bookmarks schema');
    const ids = new Set<number>(),
      urls = new Set<string>();
    const folders = data.folders.map((folder) => {
      if (
        !folder ||
        !Number.isSafeInteger(folder.id) ||
        folder.id < 1 ||
        ids.has(folder.id)
      )
        throw Error('Invalid folder ID');
      ids.add(folder.id);
      if (!validOrder(folder.order)) throw Error('Invalid folder order');
      return {
        id: folder.id,
        title: this.name(folder.title),
        order: folder.order,
      };
    });
    const legacy = legacyFolderRank(folders);
    renumber(folders, (folder) => legacy.indexOf(folder.id));
    folders.sort((a, b) => a.order! - b.order!);
    const bookmarks = data.bookmarks.map((bookmark) => {
      if (
        !bookmark ||
        typeof bookmark.url !== 'string' ||
        bookmark.url.length > 8192 ||
        !/^(https?|ipfs|ipns):\/\//i.test(bookmark.url) ||
        typeof bookmark.title !== 'string' ||
        bookmark.title.length > 8192 ||
        (bookmark.description !== undefined &&
          (typeof bookmark.description !== 'string' ||
            bookmark.description.length > 2000)) ||
        !validOrder(bookmark.order) ||
        (bookmark.folderId !== null && !ids.has(bookmark.folderId)) ||
        (bookmark.shortcutFolderId !== undefined &&
          (!ids.has(bookmark.shortcutFolderId) ||
            bookmark.shortcutFolderId === bookmark.folderId))
      )
        throw Error('Invalid bookmark');
      const url = parseAddress(bookmark.url).display;
      if (urls.has(url)) throw Error('Duplicate bookmark URL');
      urls.add(url);
      return {
        url,
        title: bookmark.title,
        folderId: bookmark.folderId,
        order: bookmark.order,
        ...(bookmark.shortcutFolderId !== undefined
          ? { shortcutFolderId: bookmark.shortcutFolderId }
          : {}),
        ...(bookmark.description !== undefined
          ? { description: bookmark.description }
          : {}),
      };
    });
    // Each folder (and the bar itself) keeps its own 0..n-1 sequence.
    const index = new Map(bookmarks.map((bookmark, i) => [bookmark, i]));
    for (const group of Map.groupBy(bookmarks, (b) => b.folderId).values())
      renumber(group, (bookmark) => index.get(bookmark)!);
    // List the bar first, then each folder in its own order.
    const rank = (bookmark: Bookmark) =>
      bookmark.folderId === null
        ? -1
        : folders.findIndex((folder) => folder.id === bookmark.folderId);
    bookmarks.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.order! - b.order! ||
        index.get(a)! - index.get(b)!,
    );
    return { version: 1, bookmarks, folders };
  }
  private name(title: string) {
    if (
      typeof title !== 'string' ||
      !title.trim() ||
      title.length > 200 ||
      Array.from(title).some(
        (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
      )
    )
      throw Error('Invalid name');
    return title.trim();
  }
  private write(data: BookmarksDocument) {
    if (!this.file) return;
    const content = JSON.stringify(data, null, 2) + '\n';
    if (Buffer.byteLength(content, 'utf8') > 16 * 1024 * 1024)
      throw Error('File exceeds 16 MiB');
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    let fd: number | undefined;
    try {
      fd = openSync(temporary, 'wx', 0o600);
      writeFileSync(fd, content, 'utf8');
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temporary, this.file);
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
  private change(update: (data: BookmarksDocument) => void) {
    const next = structuredClone(this.data);
    update(next);
    const valid = this.validate(next);
    this.write(valid);
    this.data = valid;
  }
  bookmarks() {
    return structuredClone(this.data.bookmarks);
  }
  folders() {
    return structuredClone(this.data.folders);
  }
  bookmark(url: string, title: string) {
    this.change((data) => {
      const previous = data.bookmarks.find((bookmark) => bookmark.url === url);
      if (previous) previous.title = title;
      else data.bookmarks.push({ url, title, folderId: null, order: -1 });
    });
  }
  bookmarkIPFS(url: string, title = '') {
    this.change((data) => {
      // Preserve names and locations that the user has already chosen.
      if (data.bookmarks.some((bookmark) => bookmark.url === url)) return;
      let folder = data.folders.find((folder) => folder.title === 'myIPFS');
      if (!folder) {
        folder = {
          id: data.folders.reduce((max, f) => Math.max(max, f.id), 0) + 1,
          title: 'myIPFS',
        };
        data.folders.push(folder);
      }
      const address = parseAddress(url);
      if (address.kind !== 'ipfs' || !address.root)
        throw Error('Expected IPFS address');
      const cid = address.root;
      const suffix = cid.slice(-12);
      const cleaned = Array.from(title)
        .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c))
        .join('')
        .trim()
        .slice(0, 175);
      let name = cleaned || `IPFS …${suffix}`;
      if (
        data.bookmarks.some((b) => b.folderId === folder.id && b.title === name)
      )
        name += ` · ${suffix}`;
      data.bookmarks.push({
        url,
        title: name,
        folderId: folder.id,
        order: -1,
      });
    });
  }
  removeBookmark(url: string) {
    this.change((data) => {
      data.bookmarks = data.bookmarks.filter(
        (bookmark) => bookmark.url !== url,
      );
    });
  }
  updateBookmark(
    url: string,
    title: string,
    folderId: number | null,
    order?: number,
  ) {
    if (!validPosition(order)) throw Error('Invalid position');
    this.change((data) => {
      const bookmark = data.bookmarks.find((bookmark) => bookmark.url === url);
      if (!bookmark) throw Error('Bookmark not found');
      if (
        folderId !== null &&
        !data.folders.some((folder) => folder.id === folderId)
      )
        throw Error('Invalid folder');
      bookmark.title = this.name(title);
      const moved = bookmark.folderId !== folderId;
      if (moved) delete bookmark.shortcutFolderId;
      bookmark.folderId = folderId;
      if (order !== undefined || moved)
        place(
          data.bookmarks.filter((other) => other.folderId === folderId),
          bookmark,
          order ?? 0,
        );
    });
  }
  createFolder(title: string) {
    let id = 0;
    this.change((data) => {
      id =
        data.folders.reduce((max, folder) => Math.max(max, folder.id), 0) + 1;
      data.folders.push({
        id,
        title: this.name(title),
        order: data.folders.length,
      });
    });
    return id;
  }
  renameFolder(id: number, title: string, order?: number) {
    if (!validPosition(order)) throw Error('Invalid position');
    this.change((data) => {
      const folder = data.folders.find((folder) => folder.id === id);
      if (!folder) throw Error('Folder not found');
      folder.title = this.name(title);
      if (order !== undefined) place(data.folders, folder, order);
    });
  }
  removeFolder(id: number) {
    this.change((data) => {
      if (!data.folders.some((folder) => folder.id === id))
        throw Error('Folder not found');
      data.folders = data.folders.filter((folder) => folder.id !== id);
      for (const bookmark of data.bookmarks) {
        if (bookmark.folderId === id) {
          bookmark.folderId = null;
          // Released bookmarks join the end of the bar, keeping their order.
          bookmark.order = 1e9 + (bookmark.order ?? 0);
        }
        if (bookmark.shortcutFolderId === id) delete bookmark.shortcutFolderId;
      }
    });
  }
}
