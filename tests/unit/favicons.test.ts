import { siteIcon } from '../../src/renderer/icons';
import { catalog } from '../../src/shared/catalog';
import type { BrowserAPI } from '../../src/shared/types';
import { it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { safePNG } from '../../src/main/browser/favicon-validation';
import { faviconOrigin } from '../../src/shared/address';
it('keys icons by web origin and excludes URL credentials', () => {
  expect(faviconOrigin('https://example.org/path')).toBe('https://example.org');
  expect(faviconOrigin('http://localhost:1234/')).toBe('http://localhost:1234');
  for (const url of [
    'ipns://example.org/a',
    'p2p://shared/ipns/other.example.org/b',
    'ipfs://bafybeiaysi4s6lnjev27ln5icwm6tueaw2vdykrtjkwiphwekaywqhcjze/',
    'ipfs://test',
    'p2p://fake/ipns/example.org/',
    'file:///etc/passwd',
    'data:image/png;base64,AA==',
    'https://user:pass@example.org/',
  ])
    expect(faviconOrigin(url)).toBeUndefined();
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

it('renders the entire P2P catalog without requesting favicons', () => {
  const command = vi.fn();
  vi.stubGlobal('document', { createElement: () => ({ dataset: {} }) });
  try {
    for (const entry of catalog)
      expect(
        siteIcon(entry.url, { command } as unknown as BrowserAPI).src,
      ).toBeTruthy();
    expect(command).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
