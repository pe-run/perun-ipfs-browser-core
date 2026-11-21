import { it, expect } from 'vitest';
import {
  dictionaries,
  resolveLanguage,
  translate,
  type Language,
  type MessageKey,
  isLanguage,
} from '../../src/shared/i18n';
import catalog from '../../src/shared/catalog.json';
import { parseAddress } from '../../src/shared/address';
it.each([
  ['pl-PL', 'pl'],
  ['en_US.UTF-8', 'en'],
  ['es-419', 'es'],
  ['fr-CA', 'fr'],
  ['zh-Hant-TW', 'zh'],
  ['pt-BR', 'pt'],
  ['de-DE', 'de'],
  ['ru_RU', 'ru'],
  ['ja-JP', 'ja'],
  ['ko-KR', 'ko'],
  ['C', 'en'],
  ['', 'en'],
])('maps system UI locale %s to %s', (locale, expected) =>
  expect(resolveLanguage([locale])).toBe(expected),
);
it('falls back to English when the UI language is not supported', () => {
  expect(resolveLanguage(['fi-FI', 'pl-PL'])).toBe('en');
  expect(resolveLanguage([])).toBe('en');
  expect(isLanguage('__proto__')).toBe(false);
});
it('has complete dictionaries with matching placeholders for all ten languages', () => {
  expect(Object.keys(dictionaries)).toHaveLength(10);
  for (const [code, messages] of Object.entries(dictionaries)) {
    expect(Object.keys(messages).sort()).toEqual(
      Object.keys(dictionaries.en).sort(),
    );
    for (const key of Object.keys(dictionaries.en) as MessageKey[]) {
      expect(messages[key].trim(), `${code}:${key}`).not.toBe('');
      expect(
        messages[key].match(/\{\w+\}/g)?.sort() || [],
        `${code}:${key}`,
      ).toEqual(dictionaries.en[key].match(/\{\w+\}/g)?.sort() || []);
    }
  }
  expect(translate('es', 'importSuccess', { names: '<script>' })).toContain(
    '<script>',
  );
});
it('preserves all 28 supplied catalog paths and translates every description', () => {
  expect(catalog).toHaveLength(28);
  expect(new Set(catalog.map((e) => e.url)).size).toBe(28);
  for (const entry of catalog) {
    expect(parseAddress(entry.url).kind).toBe('ipfs');
    expect(Object.keys(entry.titles).sort()).toEqual(
      Object.keys(dictionaries).sort(),
    );
    expect(Object.keys(entry.descriptions).sort()).toEqual(
      Object.keys(dictionaries).sort(),
    );
    for (const language of Object.keys(dictionaries) as Language[])
      expect(entry.descriptions[language].trim()).not.toBe('');
  }
  expect(catalog[0].url).toBe(
    'ipfs://bafybeiaysi4s6lnjev27ln5icwm6tueaw2vdykrtjkwiphwekaywqhcjze',
  );
  expect(catalog[5].url).toContain('/its-time-for-the-permanent-web.html');
  expect(catalog[17].url).toContain('/welcome-to-IPFS.jpg');
  expect(catalog[25].url).toContain('/wiki/Block_of_Wikipedia_in_Turkey');
});
