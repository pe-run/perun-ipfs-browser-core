import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { safePNG } from '../../src/main/browser/favicon-validation';
import { siteRoot } from '../../src/shared/address';
it('keys icons by web origin or content root and excludes URL credentials', () => {
  expect(siteRoot('https://example.org/path')).toBe('https://example.org');
  expect(siteRoot('http://localhost:1234/')).toBe('http://localhost:1234');
  expect(siteRoot('ipns://example.org/a')).toBe(
    'p2p://shared/ipns/example.org',
  );
  expect(siteRoot('p2p://shared/ipns/other.example.org/b')).toBe(
    'p2p://shared/ipns/other.example.org',
  );
  for (const url of [
    'ipfs://test',
    'p2p://fake/ipns/example.org/',
    'file:///etc/passwd',
    'data:image/png;base64,AA==',
    'https://user:pass@example.org/',
  ])
    expect(siteRoot(url)).toBeUndefined();
});
it('accepts only bounded 16x16 PNG cache images', () => {
  const bytes = readFileSync('resources/branding/site-web.png');
  expect(safePNG('data:image/png;base64,' + bytes.toString('base64'))).toBe(
    true,
  );
  const invalid = Buffer.from(bytes);
  invalid.writeUInt32BE(1000000, 16);
  for (const value of [
    null,
    'data:image/svg+xml;base64,AA==',
    'data:image/png;base64,AA==',
    'data:image/png;base64,' + invalid.toString('base64'),
    'data:image/png;base64,' + 'A'.repeat(32768),
  ])
    expect(safePNG(value)).toBe(false);
});
