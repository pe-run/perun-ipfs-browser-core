import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface ProfileOptions {
  home: string;
  override?: string;
}

export function prepareProfile({ home, override }: ProfileOptions) {
  const root = resolve(override || join(home, '.perun'));
  const profile = override ? root : join(root, 'profile');
  const bookmarks = join(root, 'bookmarks.json');
  const logs = join(root, 'logs');
  const temporary = join(root, 'tmp');
  const crashes = join(root, 'crashes');
  for (const path of [root, profile, logs, temporary, crashes])
    mkdirSync(path, { recursive: true, mode: 0o700 });
  return { root, profile, bookmarks, logs, temporary, crashes };
}
