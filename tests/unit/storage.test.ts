import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  starterBookmarks,
  starterFolders,
} from '../../src/shared/starter-bookmarks';
import { Store } from '../../src/main/storage/store';
it('persists history, bookmarks, settings and manual pins across restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'browser-store-')),
    file = join(dir, 'test.sqlite');
  try {
    let s = new Store(file);
    s.visit('https://example.org/', 'Title');
    s.bookmark('https://example.org/bookmark', 'Test');
    s.bookmark('https://example.org/bookmark', 'Updated');
    s.set('tabs', ['https://example.org/']);
    s.pin('cid', true);
    s.close();
    s = new Store(file);
    expect(s.history()).toHaveLength(1);
    expect(s.bookmarks()).toHaveLength(starterBookmarks.length + 1);
    expect(
      s.bookmarks().find((b) => b.url === 'https://example.org/bookmark')
        ?.title,
    ).toBe('Updated');
    expect(s.get('tabs', [])).toEqual(['https://example.org/']);
    expect(s.pins()).toEqual(['cid']);
    s.pin('cid', false);
    s.removeBookmark('https://example.org/bookmark');
    expect(s.pins()).toEqual([]);
    expect(s.bookmarks()).toHaveLength(starterBookmarks.length);
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('seeds starter bookmarks once and preserves edits and removals across restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'browser-seeds-'));
  const file = join(dir, 'test.sqlite');
  try {
    let s = new Store(file);
    expect(s.bookmarks()).toHaveLength(starterBookmarks.length);
    for (const bookmark of starterBookmarks)
      expect(s.bookmarks()).toContainEqual(expect.objectContaining(bookmark));
    s.bookmark(starterBookmarks[0].url, 'My search');
    s.removeBookmark(starterBookmarks[1].url);
    s.close();
    s = new Store(file);
    expect(s.bookmarks()).toHaveLength(starterBookmarks.length - 1);
    expect(s.bookmarks()).toContainEqual(
      expect.objectContaining({
        url: starterBookmarks[0].url,
        title: 'My search',
        folderId: null,
      }),
    );
    expect(s.bookmarks().some((b) => b.url === starterBookmarks[1].url)).toBe(
      false,
    );
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('persists bookmark folders and edits; deleting a folder preserves its bookmarks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookmark-folders-')),
    file = join(dir, 'test.sqlite');
  try {
    let s = new Store(file);
    const id = s.createFolder('Reading');
    s.updateBookmark(starterBookmarks[0].url, 'My search', id);
    s.renameFolder(id, 'Research');
    expect(() =>
      s.updateBookmark(starterBookmarks[0].url, 'Bad', 999999),
    ).toThrow();
    expect(() => s.createFolder('  ')).toThrow();
    expect(() => s.renameFolder(id, 'x'.repeat(201))).toThrow();
    s.close();
    s = new Store(file);
    expect(s.folders()).toContainEqual(
      expect.objectContaining({ id, title: 'Research' }),
    );
    expect(s.bookmarks()).toContainEqual(
      expect.objectContaining({
        url: starterBookmarks[0].url,
        title: 'My search',
        folderId: id,
      }),
    );
    s.removeFolder(id);
    expect(s.bookmarks()).toContainEqual(
      expect.objectContaining({
        url: starterBookmarks[0].url,
        title: 'My search',
        folderId: null,
      }),
    );
    s.removeBookmark(starterBookmarks[0].url);
    s.close();
    s = new Store(file);
    expect(s.folders()).toEqual(
      expect.arrayContaining(
        starterFolders.map((folder) => expect.objectContaining(folder)),
      ),
    );
    expect(s.bookmarks().some((b) => b.url === starterBookmarks[0].url)).toBe(
      false,
    );
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
