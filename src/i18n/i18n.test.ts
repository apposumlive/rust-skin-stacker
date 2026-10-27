import { describe, expect, it } from 'vitest';
import en from './en.json';
import ru from './ru.json';
import { detectLang, errorText, setLang, t, tn } from './index';

const PLURAL = /_(zero|one|two|few|many|other)$/;
const baseKeys = (dict: object) => [...new Set(Object.keys(dict).map((k) => k.replace(PLURAL, '')))].sort();
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  it('en and ru have the same keys', () => {
    expect(baseKeys(ru)).toEqual(baseKeys(en));
  });

  it('plural keys have every form the language needs', () => {
    const plurals = baseKeys(Object.fromEntries(Object.entries(en).filter(([k]) => PLURAL.test(k))));
    for (const key of plurals) {
      for (const form of ['one', 'other']) expect(Object.keys(en)).toContain(`${key}_${form}`);
      for (const form of ['one', 'few', 'many', 'other']) expect(Object.keys(ru)).toContain(`${key}_${form}`);
    }
  });

  it('placeholders match between languages', () => {
    const ruDict = ru as Record<string, string>;
    for (const [key, text] of Object.entries(en)) {
      const other = ruDict[key];
      if (other !== undefined) expect(placeholders(other), key).toEqual(placeholders(text));
    }
  });

  it('substitutes variables and plural forms', () => {
    setLang('ru');
    expect(t('time.seconds', { n: 3 })).toBe('~3\u00a0с');
    expect(tn('plan.requests', 1)).toBe('1\u00a0запрос');
    expect(tn('plan.requests', 2)).toBe('2\u00a0запроса');
    expect(tn('plan.requests', 5)).toBe('5\u00a0запросов');
    expect(tn('plan.requests', 21)).toBe('21\u00a0запрос');
    setLang('en');
    expect(tn('plan.requests', 1)).toBe('1\u00a0request');
    expect(tn('plan.requests', 72)).toBe('72\u00a0requests');
  });

  it('keeps numbers and their units together with a no-break space', () => {
    // В узкой колонке (304 px) обычный пробел отрывал «шт.», «запрос», «с» и «мин» от числа.
    for (const [lang, dict] of [
      ['en', en],
      ['ru', ru],
    ] as const) {
      for (const [key, text] of Object.entries(dict as Record<string, string>)) {
        expect(text, `${lang} ${key}`).not.toMatch(/\{(count|n|value|seconds|h|m)\} /);
        expect(text, `${lang} ${key}`).not.toMatch(/\d /);
      }
    }
    setLang('ru');
    expect(t('card.total', { count: '41' })).toBe('41 шт.');
    expect(t('item.cost', { requests: tn('plan.requests', 1), time: t('time.seconds', { n: 1 }) })).toBe('1 запрос, ~1 с');
    expect(t('time.hoursMinutes', { h: 1, m: 5 })).toBe('~1 ч 5 мин');
    setLang('en');
    expect(t('card.total', { count: '41' })).toBe('41 pcs');
    expect(t('settings.delayValue', { value: '1.5' })).toBe('1.5 s');
  });

  it('returns the key when the text is missing', () => {
    setLang('ru');
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('turns error codes into text', () => {
    setLang('en');
    expect(errorText({ code: 'http', status: 502 })).toBe('Steam answered with error 502. Try again later.');
    expect(errorText({ code: 'whatever', status: null })).toBe(t('error.unknown'));
  });

  it('detects the language from the system locale', () => {
    expect(detectLang('ru-RU')).toBe('ru');
    expect(detectLang('en-US')).toBe('en');
    expect(detectLang('de-DE')).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });
});
