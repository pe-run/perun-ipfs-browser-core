import previous from './catalog.json';
import availability from './catalog-availability.json';
import additions from './catalog-additions.json';
import type { Language } from './i18n';
export const catalogCategories = [
  'documentation',
  'browsers',
  'directories',
  'knowledge',
  'technology',
  'applications',
  'defi',
  'archives',
  'culture',
  'blogs',
  'graphics',
  'radio',
  'organizations',
  'tools',
  'events',
  'previous',
  'infrastructure',
] as const;
export type CatalogCategory = (typeof catalogCategories)[number];
export type CatalogStatus = 'manifest' | 'reference' | 'index' | 'previous';
export interface CatalogEntry {
  url: string;
  title: string;
  descriptions: Partial<Record<Language, string>>;
  titles?: Partial<Record<Language, string>>;
  category: CatalogCategory;
  status: CatalogStatus;
  domain?: string;
}
export const catalogCandidates: CatalogEntry[] = [
  ...additions.map((entry) => ({
    ...entry,
    category: entry.category as CatalogCategory,
    status: entry.status as CatalogStatus,
  })),
  ...previous.map((entry) => ({
    ...entry,
    category: 'previous' as const,
    status: 'previous' as const,
  })),
];
const available = new Set(availability.urls);
export const catalog = catalogCandidates.filter((entry) =>
  available.has(entry.url),
);
export function catalogDescription(
  entry: CatalogEntry,
  language: Language,
): string {
  return (
    entry.descriptions[language] ||
    entry.descriptions.en ||
    entry.descriptions.pl ||
    entry.title
  );
}
