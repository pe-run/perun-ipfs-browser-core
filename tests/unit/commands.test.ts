import { it, expect } from 'vitest';
import { parseCommand } from '../../src/main/security/commands';

it('accepts each action with its own fields', () => {
  for (const command of [
    { action: 'new' },
    { action: 'navigate', url: 'ipfs://bafy/' },
    { action: 'switch', id: 3 },
    { action: 'setToolbarHeight', height: 112 },
    { action: 'setLanguage', language: 'pl' },
    { action: 'setLanguage', language: 'auto' },
    {
      action: 'updateBookmark',
      url: 'https://a/',
      title: 'A',
      folderId: null,
      order: 0,
    },
    { action: 'openBookmarkOverflow', order: 4, x: 10, y: 90 },
    {
      action: 'setSitePreferences',
      id: 2,
      url: 'https://a/',
      zoom: 125,
      muted: true,
    },
    {
      action: 'saveFavicon',
      url: 'https://a/',
      image: 'data:image/png;base64,',
      sourceKey: '[]',
    },
    // Undefined optional fields are ignored, as JSON-like callers produce them.
    { action: 'close', id: undefined },
  ])
    expect(parseCommand(command)).toBe(command);
});

it('rejects malformed commands and unknown actions', () => {
  for (const raw of [
    null,
    'new',
    [],
    {},
    { action: 7 },
    { action: 'pin' },
    { action: 'toString' },
  ])
    expect(() => parseCommand(raw), JSON.stringify(raw)).toThrow(
      'Invalid command',
    );
});

it('rejects fields that the action does not take, or with invalid values', () => {
  for (const command of [
    { action: 'state', id: 1 },
    { action: 'reload', url: 'https://a/' },
    { action: 'new', image: 'x' },
    { action: 'navigate', url: 'x'.repeat(8193) },
    { action: 'switch', id: 0 },
    { action: 'switch', id: 1.5 },
    { action: 'setToolbarHeight', height: 79 },
    { action: 'setToolbarHeight', height: 241 },
    { action: 'setLanguage', language: 'xx' },
    { action: 'createFolder', title: '   ' },
    { action: 'createFolder', title: 'a\nb' },
    { action: 'createFolder', title: 'x'.repeat(201) },
    { action: 'updateBookmark', url: 'https://a/', title: 'A', folderId: 0 },
    { action: 'openBookmarkFolder', id: 1, x: -1, y: 0 },
    { action: 'openBookmarkOverflow', order: -1, x: 0, y: 0 },
    { action: 'setSitePreferences', id: 1, url: 'https://a/', zoom: 300 },
    { action: 'setSitePreferences', id: 1, url: 'https://a/', muted: 'yes' },
    {
      action: 'saveFavicon',
      url: 'https://a/',
      image: 'x'.repeat(32769),
      sourceKey: '',
    },
  ])
    expect(
      () => parseCommand(command),
      JSON.stringify(command).slice(0, 80),
    ).toThrow('Invalid arguments');
});
