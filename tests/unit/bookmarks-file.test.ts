import { it, expect } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
  readdirSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../src/main/storage/store';
import { BookmarksFile } from '../../src/main/storage/bookmarks';
import {
  starterBookmarks,
  starterFolders,
} from '../../src/shared/starter-bookmarks';
function fixture(run: (file: string, db: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'perun-json-'));
  try {
    run(join(dir, '.perun', 'bookmarks.json'), join(dir, 'browser.sqlite'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
it('writes real JSON, persists empty lists and restores defaults only after file deletion', () =>
  fixture((file, db) => {
    let store = new Store(db, file);
    let document = JSON.parse(readFileSync(file, 'utf8'));
    expect(document.version).toBe(1);
    expect(document.folders).toEqual(starterFolders);
    expect(
      store
        .bookmarks()
        .filter((bookmark) => bookmark.folderId === null)
        .map((bookmark) => bookmark.title),
    ).toEqual(['DuckDuckGo', 'Mojeek']);
    const finance = store
      .folders()
      .find((folder) => folder.title === 'Finance')!;
    expect(
      store
        .bookmarks()
        .filter((b) => b.folderId === finance.id)
        .map((b) => b.url),
    ).toEqual([
      'https://coinmarketcap.com/',
      'https://app.uniswap.org/',
      'https://app.hyperliquid.xyz/',
      'https://www.sushi.com/ethereum/swap',
      'https://www.coingecko.com/',
    ]);
    expect(document.bookmarks).toHaveLength(starterBookmarks.length);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    for (const bookmark of store.bookmarks())
      store.removeBookmark(bookmark.url);
    store.close();
    store = new Store(db, file);
    expect(store.bookmarks()).toEqual([]);
    rmSync(file); // Deleting while open must not be undone by a shutdown save.
    store.close();
    store = new Store(db, file);
    expect(store.bookmarks()).toEqual(
      expect.arrayContaining(
        starterBookmarks.map((bookmark) => expect.objectContaining(bookmark)),
      ),
    );
    store.close();
    document = JSON.parse(readFileSync(file, 'utf8'));
    expect(document.bookmarks).toHaveLength(starterBookmarks.length);
  }));
it('keeps the Mojeek shortcut while renaming and removes it when Search is deleted', () =>
  fixture((file, db) => {
    const store = new Store(db, file);
    const url = 'https://www.mojeek.com/';
    const search = store.folders().find((folder) => folder.title === 'Search')!;
    store.updateBookmark(url, 'Mojeek Search', null);
    expect(
      store.bookmarks().find((bookmark) => bookmark.url === url),
    ).toMatchObject({
      title: 'Mojeek Search',
      folderId: null,
      shortcutFolderId: search.id,
    });
    store.removeFolder(search.id);
    const bookmark = store.bookmarks().find((bookmark) => bookmark.url === url);
    expect(bookmark?.folderId).toBeNull();
    expect(bookmark).not.toHaveProperty('shortcutFolderId');
    store.close();
  }));
it('uses manual JSON edits at startup, rather than SQLite, and preserves folders', () =>
  fixture((file, db) => {
    let store = new Store(db, file);
    store.bookmark('https://example.org/', 'Example');
    store.close();
    const document = JSON.parse(readFileSync(file, 'utf8'));
    document.folders = [{ id: 42, title: 'Manual folder' }];
    document.bookmarks = [
      {
        url: 'https://example.org/',
        title: 'Edited outside browser',
        folderId: 42,
      },
    ];
    writeFileSync(file, JSON.stringify(document));
    store = new Store(db, file);
    expect(store.bookmarks()).toMatchObject(document.bookmarks);
    expect(store.folders()).toMatchObject(document.folders);
    store.renameFolder(42, 'Renamed');
    store.close();
    expect(JSON.parse(readFileSync(file, 'utf8')).folders[0].title).toBe(
      'Renamed',
    );
  }));
it('preserves malformed or unsafe documents without replacing them with defaults', () =>
  fixture((file, db) => {
    new Store(db, file).close();
    for (const value of [
      '{broken',
      JSON.stringify({ version: 2, bookmarks: [], folders: [] }),
      JSON.stringify({
        version: 1,
        bookmarks: [
          { url: 'javascript:alert(1)', title: 'Unsafe', folderId: null },
        ],
        folders: [],
      }),
      JSON.stringify({
        version: 1,
        bookmarks: [
          {
            url: 'https://example.org/',
            title: 'Missing folder',
            folderId: 99,
          },
        ],
        folders: [],
      }),
    ]) {
      writeFileSync(file, value);
      expect(() => new Store(db, file)).toThrow('Cannot load bookmarks');
      expect(readFileSync(file, 'utf8')).toBe(value);
    }
  }));
it('keeps in-memory data and removes temporary files if atomic replacement fails', () =>
  fixture((file) => {
    const bookmarks = new BookmarksFile(file),
      before = bookmarks.bookmarks();
    rmSync(file);
    mkdirSync(file);
    expect(() => bookmarks.removeBookmark(before[0].url)).toThrow();
    expect(bookmarks.bookmarks()).toEqual(before);
    expect(readdirSync(join(file, '..'))).toEqual(['bookmarks.json']);
  }));

it('groups imported IPFS bookmarks atomically, names duplicates by CID and preserves user edits', () =>
  fixture((file, db) => {
    let store = new Store(db, file);
    const a =
      'ipfs://bafybeiaysi4s6lnjev27ln5icwm6tueaw2vdykrtjkwiphwekaywqhcjze/';
    const b =
      'ipfs://bafybeibiqlrnmws6psog7rl5ofeci3ontraitllw6wyyswnhxbwdkmw4ka/';
    const c =
      'ipfs://bafybeieuutdavvf55sh3jktq2dpi2hkle6dtmebe7uklod3ramihyf3xa4/';
    const folderId = store.createFolder('myIPFS');
    store.bookmarkIPFS(a, 'post.html');
    store.bookmarkIPFS(b, 'post.html');
    store.bookmarkIPFS(c);
    expect(store.folders().filter((f) => f.title === 'myIPFS')).toHaveLength(1);
    expect(store.bookmarks().find((b) => b.url === a)).toEqual({
      url: a,
      title: 'post.html',
      folderId,
      order: expect.any(Number),
    });
    expect(store.bookmarks().find((item) => item.url === b)?.title).toBe(
      'post.html · ' + new URL(b).hostname.slice(-12),
    );
    expect(store.bookmarks().find((item) => item.url === c)?.title).toBe(
      'IPFS …' + new URL(c).hostname.slice(-12),
    );
    store.updateBookmark(a, 'My name', null);
    store.bookmarkIPFS(a, 'post.html');
    store.close();
    store = new Store(db, file);
    expect(store.bookmarks().find((b) => b.url === a)).toEqual({
      url: a,
      title: 'My name',
      folderId: null,
      order: expect.any(Number),
    });
    expect(
      store.bookmarks().filter((b) => b.folderId === folderId),
    ).toHaveLength(2);
    store.close();
  }));

it('inserts new bookmarks first and preserves their order on reload', () =>
  fixture((file) => {
    const bookmarks = new BookmarksFile(file);
    bookmarks.bookmark('https://a.example/', 'A');
    bookmarks.bookmark('https://z.example/', 'Z');
    bookmarks.bookmark('https://a.example/', 'Updated A');
    const reopened = new BookmarksFile(file);
    expect(
      reopened
        .bookmarks()
        .slice(0, 2)
        .map(({ title }) => title),
    ).toEqual(['Z', 'Updated A']);
  }));

const titles = (bookmarks: { title: string }[]) =>
  bookmarks.map(({ title }) => title);
it('lets the user reorder bookmarks within the bar and folders, and persists the order', () =>
  fixture((file) => {
    const empty = { version: 1, bookmarks: [], folders: [] };
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify(empty));
    const bookmarks = new BookmarksFile(file);
    const folder = bookmarks.createFolder('Folder');
    const other = bookmarks.createFolder('Other');
    for (const name of ['a', 'b', 'c'])
      bookmarks.bookmark(`https://${name}.example/`, name);
    // New bookmarks go first.
    expect(titles(bookmarks.bookmarks())).toEqual(['c', 'b', 'a']);
    bookmarks.updateBookmark('https://a.example/', 'a', null, 0);
    expect(titles(bookmarks.bookmarks())).toEqual(['a', 'c', 'b']);
    bookmarks.updateBookmark('https://a.example/', 'a', null, 2);
    expect(titles(bookmarks.bookmarks())).toEqual(['c', 'b', 'a']);
    // Moving to a folder without a position puts the bookmark first there.
    bookmarks.updateBookmark('https://a.example/', 'a', folder);
    bookmarks.updateBookmark('https://b.example/', 'b', folder);
    expect(
      titles(bookmarks.bookmarks().filter((b) => b.folderId === folder)),
    ).toEqual(['b', 'a']);
    // Folders are ordered by the order field, not by name.
    bookmarks.renameFolder(other, 'Other', 0);
    expect(bookmarks.folders().map(({ title }) => title)).toEqual([
      'Other',
      'Folder',
    ]);
    const reopened = new BookmarksFile(file);
    expect(reopened.folders().map(({ id }) => id)).toEqual([other, folder]);
    expect(
      titles(reopened.bookmarks().filter((b) => b.folderId === folder)),
    ).toEqual(['b', 'a']);
    // Hand-edited order values are honoured and renumbered; files without them keep their layout.
    const document = JSON.parse(readFileSync(file, 'utf8'));
    document.bookmarks.find((b: { title: string }) => b.title === 'a').order =
      -5;
    writeFileSync(file, JSON.stringify(document));
    expect(
      titles(
        new BookmarksFile(file)
          .bookmarks()
          .filter((b) => b.folderId === folder),
      ),
    ).toEqual(['a', 'b']);
    expect(() => bookmarks.renameFolder(other, 'Other', 1.5)).toThrow();
  }));
it('derives order for files written before the order field existed', () =>
  fixture((file) => {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        folders: [
          { id: 1, title: 'Zeta' },
          { id: 2, title: 'Search' },
          { id: 3, title: 'Alpha' },
        ],
        bookmarks: [
          { url: 'https://one.example/', title: 'one', folderId: null },
          { url: 'https://two.example/', title: 'two', folderId: null },
        ],
      }),
    );
    const bookmarks = new BookmarksFile(file);
    expect(bookmarks.folders().map(({ title }) => title)).toEqual([
      'Search',
      'Alpha',
      'Zeta',
    ]);
    expect(titles(bookmarks.bookmarks())).toEqual(['one', 'two']);
  }));
