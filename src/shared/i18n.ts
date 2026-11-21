import ja from './locales/ja.json';
import ko from './locales/ko.json';
import en from './locales/en.json';
import pl from './locales/pl.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import zh from './locales/zh.json';
import pt from './locales/pt.json';
import de from './locales/de.json';
import ru from './locales/ru.json';
export const dictionaries = { en, pl, es, fr, zh, pt, de, ru, ja, ko };
export type Language = keyof typeof dictionaries;
export type MessageKey = keyof typeof en;
export type LanguagePreference = Language | 'auto';
export const languageNames: Record<Language, string> = {
  en: 'English',
  pl: 'Polski',
  es: 'Español',
  fr: 'Français',
  zh: '中文',
  pt: 'Português',
  de: 'Deutsch',
  ru: 'Русский',
  ja: '日本語',
  ko: '한국어',
};
let current: Language = 'en';
export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && Object.hasOwn(dictionaries, value);
}
export function resolveLanguage(preferred: readonly string[]): Language {
  // Match the UI language, not a supported secondary language of a different UI.
  const primary = (preferred[0] || 'en')
    .replace(/_/g, '-')
    .split(/[.@]/)[0]
    .split('-')[0]
    .toLowerCase();
  return isLanguage(primary) ? primary : 'en';
}
export function setLocale(language: Language) {
  current = language;
}
export function getLocale(): Language {
  return current;
}
export function translate(
  language: Language,
  key: MessageKey,
  params: Record<string, string | number> = {},
): string {
  const template = dictionaries[language][key] || en[key];
  return template.replace(/\{(\w+)\}/g, (original, name: string) =>
    String(params[name] ?? original),
  );
}
export function t(
  key: MessageKey,
  params: Record<string, string | number> = {},
): string {
  return translate(current, key, params);
}
// Preserve engine diagnostics, while translating the browser-owned status/error text.
export function localizeMessage(message: string): string {
  const direct: Record<string, MessageKey> = {
    Gotowy: 'ready',
    Uruchamianie: 'starting',
    Zatrzymany: 'stopped',
  };
  if (direct[message]) return t(direct[message]);
  for (const [key, polish] of Object.entries(pl))
    if (!polish.includes('{') && message === polish)
      return t(key as MessageKey);
  if (message.startsWith('Błąd: '))
    return t('error', { error: message.slice(6) });
  if (message.startsWith('Awaria Kubo '))
    return t('nodeCrash', { error: message.slice(11) });
  return message;
}
