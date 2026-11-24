import { BookmarksFile } from './bookmarks';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
/** Older visits are dropped so the history table cannot grow without bound. */
export const historyLimit = 10000;
export class Store {
  private db: DatabaseSync;
  private favorites: BookmarksFile;
  constructor(file: string, bookmarksFile?: string) {
    this.db = new DatabaseSync(file);
    try {
      this.db.exec(`
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS history(
          id INTEGER PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL,
          visited INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS pins(cid TEXT PRIMARY KEY);
      `);
      this.favorites = new BookmarksFile(
        bookmarksFile ??
          (file === ':memory:'
            ? undefined
            : join(dirname(file), 'bookmarks.json')),
      );
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  visit(url: string, title: string) {
    this.db
      .prepare('INSERT INTO history(url,title,visited) VALUES(?,?,?)')
      .run(url, title, Date.now());
    this.db
      .prepare(
        'DELETE FROM history WHERE id < (SELECT id FROM history ORDER BY id DESC LIMIT 1 OFFSET ?)',
      )
      .run(historyLimit - 1);
  }
  clearHistory() {
    this.db.exec('DELETE FROM history');
  }
  bookmark(url: string, title: string) {
    this.favorites.bookmark(url, title);
  }
  bookmarkIPFS(url: string, title?: string) {
    this.favorites.bookmarkIPFS(url, title);
  }
  removeBookmark(url: string) {
    this.favorites.removeBookmark(url);
  }
  history() {
    return this.db
      .prepare('SELECT * FROM history ORDER BY id DESC LIMIT 300')
      .all();
  }
  bookmarks() {
    return this.favorites.bookmarks();
  }
  folders() {
    return this.favorites.folders();
  }
  createFolder(title: string) {
    return this.favorites.createFolder(title);
  }
  renameFolder(id: number, title: string, order?: number) {
    this.favorites.renameFolder(id, title, order);
  }
  removeFolder(id: number) {
    this.favorites.removeFolder(id);
  }
  updateBookmark(
    url: string,
    title: string,
    folderId: number | null,
    order?: number,
  ) {
    this.favorites.updateBookmark(url, title, folderId, order);
  }
  set(key: string, value: unknown) {
    this.db
      .prepare('INSERT OR REPLACE INTO settings VALUES(?,?)')
      .run(key, JSON.stringify(value));
  }
  get<T>(key: string, fallback: T): T {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key=?')
      .get(key);
    return row ? (JSON.parse(row.value as string) as T) : fallback;
  }
  pin(cid: string, value: boolean) {
    this.db
      .prepare(
        value
          ? 'INSERT OR IGNORE INTO pins VALUES(?)'
          : 'DELETE FROM pins WHERE cid=?',
      )
      .run(cid);
  }
  pins() {
    return this.db
      .prepare('SELECT cid FROM pins')
      .all()
      .map((r) => r.cid as string);
  }
  close() {
    this.db.close();
  }
}
