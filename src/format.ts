import { getLang, t } from './i18n';

export const ICON_BASE = 'https://community.akamai.steamstatic.com/economy/image/';

/** Картинка предмета с CDN Steam — единственный внешний адрес, который грузит окно. */
export function iconUrl(hash: string, size: number): string {
  return `${ICON_BASE}${encodeURIComponent(hash)}/${size}fx${size}f`;
}

export function fmtInt(n: number): string {
  return new Intl.NumberFormat(getLang()).format(n);
}

/** Миллисекунды → секунды с одним знаком: «1,5». */
export function fmtSeconds(ms: number): string {
  return new Intl.NumberFormat(getLang(), { maximumFractionDigits: 1 }).format(ms / 1000);
}

/** «~3 с», «~2 мин», «~1 ч 5 мин». */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return t('time.seconds', { n: s });
  const m = Math.ceil(s / 60);
  if (m < 60) return t('time.minutes', { n: m });
  return t('time.hoursMinutes', { h: Math.floor(m / 60), m: m % 60 });
}

/** Сколько секунд осталось до `until` (миллисекунды, как у `Date.now()`): вверх до целых, прошло — 0. */
export function remainingSeconds(until: number, now: number): number {
  const seconds = Math.ceil((until - now) / 1000);
  return seconds > 0 ? seconds : 0;
}

/** Сколько ещё живёт токен: «18 ч», «25 мин», «истёк». */
export function fmtTimeLeft(expiresAt: number, nowSec: number): string {
  const left = expiresAt - nowSec;
  if (left <= 0) return t('time.expired');
  if (left < 3600) return t('time.minutesShort', { n: Math.max(1, Math.floor(left / 60)) });
  return t('time.hoursShort', { n: Math.floor(left / 3600) });
}

/** Паузы между запросами плюс около 0,3 с на сам запрос. */
export function estimateSeconds(requests: number, delayMs: number): number {
  if (requests <= 0) return 0;
  return (requests - 1) * (delayMs / 1000) + requests * 0.3;
}

/** «2 нояб.» из ISO-даты Steam; непонятную строку показываем как есть. */
export function fmtDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(getLang(), { day: 'numeric', month: 'short' }).format(date);
}
