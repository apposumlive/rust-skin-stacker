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
    expect(t('time.seconds', { n: 3 })).toBe('~3 с');
    expect(tn('plan.requests', 1)).toBe('1 запрос');
    expect(tn('plan.requests', 2)).toBe('2 запроса');
    expect(tn('plan.requests', 5)).toBe('5 запросов');
    expect(tn('plan.requests', 21)).toBe('21 запрос');
    setLang('en');
    expect(tn('plan.requests', 1)).toBe('1 request');
    expect(tn('plan.requests', 72)).toBe('72 requests');
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
