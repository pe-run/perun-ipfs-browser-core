import audit from '../../docs/catalog-audit.json';
import { it, expect } from 'vitest';
import {
  catalogCandidates as catalog,
  catalog as visibleCatalog,
  catalogCategories,
  catalogDescription,
} from '../../src/shared/catalog';
import { parseAddress } from '../../src/shared/address';
import previous from '../../src/shared/catalog.json';
it('contains all 122 addresses exactly once with the requested category counts', () => {
  expect(catalog).toHaveLength(122);
  expect(new Set(catalog.map((entry) => entry.url)).size).toBe(122);
  const expected = {
    documentation: 7,
    browsers: 3,
    directories: 1,
    knowledge: 8,
    technology: 6,
    applications: 1,
    defi: 2,
    archives: 3,
    culture: 13,
    blogs: 20,
    graphics: 7,
    radio: 11,
    organizations: 9,
    tools: 1,
    events: 1,
    previous: 28,
    infrastructure: 1,
  };
  for (const category of catalogCategories)
    expect(catalog.filter((entry) => entry.category === category)).toHaveLength(
      expected[category],
    );
  for (const entry of catalog) {
    expect(['ipfs', 'ipns']).toContain(parseAddress(entry.url).kind);
    expect(entry.descriptions.en?.trim()).toBeTruthy();
    expect(entry.descriptions.pl?.trim()).toBeTruthy();
    expect(['manifest', 'reference', 'index', 'previous']).toContain(
      entry.status,
    );
  }
  expect(
    catalog
      .filter((entry) => entry.category === 'previous')
      .map((entry) => entry.url),
  ).toEqual(previous.map((entry) => entry.url));
});
it('preserves domains, snapshot notes and exact unusual URLs without fetching them', () => {
  expect(catalog.find((e) => e.url === 'ipns://docs.ipfs.tech')?.status).toBe(
    'reference',
  );
  expect(catalog.find((e) => e.domain === 'docs.distributed.press')?.url).toBe(
    'ipns://k51qzi5uqu5dicruj8whyde1z5vtm2tg6q1gey17nb2trkuh4b0m69sl6z85cw/',
  );
  expect(
    catalog.find((e) => e.url === 'ipns://soundpojectradio.sutty.nl/')?.status,
  ).toBe('index');
  expect(catalog.find((e) => e.url === 'ipns://brantly.eth')?.category).toBe(
    'technology',
  );
  expect(
    catalog.find((e) => e.title === 'Uniswap 5.167.0')?.descriptions.en,
  ).toContain('2026-10-21');
  expect(
    catalog.some((e) => e.url.endsWith('/wiki/Tokyo_National_Museum.html')),
  ).toBe(true);
});
it('falls back honestly to English for untranslated contributed metadata', () => {
  const entry = catalog[0];
  expect(catalogDescription(entry, 'pl')).toBe(entry.descriptions.pl);
  expect(catalogDescription(entry, 'ja')).toBe(entry.descriptions.en);
});

it('shows only audited available resources and preserves the original submitted metadata', () => {
  expect(visibleCatalog.length).toBeGreaterThan(0);
  expect(visibleCatalog.length).toBeLessThan(catalog.length);
  expect(new Set(visibleCatalog.map((entry) => entry.url)).size).toBe(
    visibleCatalog.length,
  );
  expect(
    visibleCatalog.every((entry) =>
      catalog.some((candidate) => candidate.url === entry.url),
    ),
  ).toBe(true);
  const available = audit.results
    .filter((result) => result.available)
    .map((result) => result.url)
    .sort();
  expect(visibleCatalog.map((entry) => entry.url).sort()).toEqual(available);
  expect(audit.results).toHaveLength(catalog.length);
  for (const result of audit.results) {
    if (result.available)
      expect(['sample', 'directory-listing']).toContain(result.content);
    else {
      expect(result.attempts).toBe(2);
      expect(result.error).not.toBe('');
    }
  }
});
