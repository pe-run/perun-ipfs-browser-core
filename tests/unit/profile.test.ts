import { it, expect } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareProfile } from '../../src/main/storage/profile';

it('creates private directories and reuses existing data in default and custom profiles', () => {
  const home = mkdtempSync(join(tmpdir(), 'perun-profile-'));
  try {
    for (const override of [undefined, join(home, 'isolated')]) {
      const paths = prepareProfile({ home, override });
      expect(paths.root).toBe(override ?? join(home, '.perun'));
      expect(paths.profile).toBe(override ?? join(paths.root, 'profile'));
      expect(paths.bookmarks).toBe(join(paths.root, 'bookmarks.json'));
      for (const path of [
        paths.root,
        paths.profile,
        paths.logs,
        paths.temporary,
        paths.crashes,
      ])
        expect(statSync(path).mode & 0o777).toBe(0o700);
      writeFileSync(paths.bookmarks, 'existing data');
      expect(prepareProfile({ home, override })).toEqual(paths);
      expect(readFileSync(paths.bookmarks, 'utf8')).toBe('existing data');
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
