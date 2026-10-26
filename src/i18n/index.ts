import en from './en.json';
import ru from './ru.json';
import type { UiError } from '../types';

export type Lang = 'en' | 'ru';
type Vars = Record<string, string | number>;

const dicts: Record<Lang, Record<string, string>> = { en, ru };
let current: Lang = 'en';

export function detectLang(locale: string | undefined): Lang {
  return locale?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

export function has(key: string): boolean {
  return key in dicts[current] || key in dicts.en;
}

/** Текст по ключу; `{name}` заменяется значением из vars. Нет текста — ключ. */
export function t(key: string, vars: Vars = {}): string {
  const text = dicts[current][key] ?? dicts.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** Множественное число: `ключ_one/_few/_many/_other` по правилам языка, `{count}` — число в формате языка. */
export function tn(key: string, count: number, vars: Vars = {}): string {
  const full = `${key}_${new Intl.PluralRules(current).select(count)}`;
  const chosen = full in dicts[current] ? full : `${key}_other`;
  return t(chosen, { count: new Intl.NumberFormat(current).format(count), ...vars });
}

/** Текст ошибки ядра по её коду. */
export function errorText(error: UiError): string {
  const key = `error.${error.code}`;
  return has(key) ? t(key, { status: error.status ?? '' }) : t('error.unknown');
}
