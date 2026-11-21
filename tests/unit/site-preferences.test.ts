import { it, expect } from 'vitest';
import { Store } from '../../src/main/storage/store';
import { siteScope, sitePreferences } from '../../src/main/browser/preferences';
it('scopes HTTP preferences by origin and IPFS/IPNS by content root', () => {
  expect(siteScope('https://example.org/path?a=1')).toBe('https://example.org');
  expect(siteScope('http://localhost:3000/x')).not.toBe(
    siteScope('http://localhost:3001/x'),
  );
  const cid = 'bafybeiaysi4s6lnjev27ln5icwm6tueaw2vdykrtjkwiphwekaywqhcjze';
  expect(siteScope(`ipfs://${cid}/ipfs_links.txt`)).toBe(`ipfs://${cid}`);
  expect(siteScope('ipns://example.org/a')).toBe('ipns://example.org');
});
it('stores preferences and rejects invalid persisted values', () => {
  const store = new Store(':memory:');
  try {
    expect(sitePreferences(store, 'https://example.org')).toEqual({
      zoom: 100,
      muted: false,
    });
    store.set('site:https://example.org', { zoom: 150, muted: true });
    expect(sitePreferences(store, 'https://example.org/other')).toEqual({
      zoom: 150,
      muted: true,
    });
    expect(sitePreferences(store, 'http://example.org')).toEqual({
      zoom: 100,
      muted: false,
    });
    store.set('site:https://example.org', { zoom: 9999, muted: 'yes' });
    expect(sitePreferences(store, 'https://example.org')).toEqual({
      zoom: 100,
      muted: false,
    });
  } finally {
    store.close();
  }
});
