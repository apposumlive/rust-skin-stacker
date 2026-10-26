import { beforeEach, describe, expect, it } from 'vitest';
import { setLang } from './i18n';
import { estimateSeconds, fmtDuration, fmtInt, fmtSeconds, fmtTimeLeft, iconUrl } from './format';

describe('format', () => {
  beforeEach(() => setLang('ru'));

  it('formats integers with the language separator', () => {
    expect(fmtInt(1234).replace(/\s/g, ' ')).toBe('1 234');
  });

  it('formats durations', () => {
    expect(fmtDuration(2.1)).toBe('~3 с');
    expect(fmtDuration(59)).toBe('~59 с');
    expect(fmtDuration(61)).toBe('~2 мин');
    expect(fmtDuration(3900)).toBe('~1 ч 5 мин');
  });

  it('estimates time from requests and pause', () => {
    expect(estimateSeconds(0, 1500)).toBe(0);
    expect(estimateSeconds(2, 1500)).toBeCloseTo(2.1);
    expect(estimateSeconds(72, 1500)).toBeCloseTo(71 * 1.5 + 72 * 0.3);
  });

  it('shows how long the token lives', () => {
    const now = 1_800_000_000;
    expect(fmtTimeLeft(now + 18 * 3600 + 5, now)).toBe('18 ч');
    expect(fmtTimeLeft(now + 120, now)).toBe('2 мин');
    expect(fmtTimeLeft(now + 10, now)).toBe('1 мин');
    expect(fmtTimeLeft(now, now)).toBe('истёк');
  });

  it('builds icon urls on the Steam CDN', () => {
    expect(iconUrl('abc_DEF-1', 128)).toBe('https://community.akamai.steamstatic.com/economy/image/abc_DEF-1/128fx128f');
  });

  it('formats seconds with one decimal', () => {
    expect(fmtSeconds(1500)).toBe('1,5');
    setLang('en');
    expect(fmtSeconds(1500)).toBe('1.5');
    expect(fmtSeconds(2000)).toBe('2');
  });
});
