// Чистые решения сетки: заголовок, пустое состояние, кнопка плашки ошибки, клавиши карточки. Их проверяют тесты.

import { tn } from '../i18n';
import { isInert, matches, type Card, type Filter, type SelectMode, type Show } from '../model';
import type { Panel } from '../store';
import type { Inventory, UiError } from '../types';

/** Заголовок сетки по тому, что в ней сейчас (карточек): «40 предметов», «6 стопок», «5 предметов можно собрать». */
export function gridMeta(show: Show, count: number): string {
  return tn(`grid.meta.${show}`, count);
}

export interface EmptyState {
  /** Ключ текста. */
  text: string;
  /** Кнопка под текстом: «Показать все», «Показать их» (непередаваемые), «Сбросить фильтры» или никакой. */
  action: 'showAll' | 'showUntradable' | 'reset' | null;
}

/** Что сказать, когда в сетке пусто. Пустой инвентарь — без кнопки: фильтры тут ни при чём. */
export function emptyStateOf(inventory: Inventory, filter: Filter): EmptyState {
  if (inventory.skins.length === 0) return { text: 'grid.empty', action: null };
  if (filter.show === 'stacks' && !filter.search.trim() && filter.categories.length === 0) {
    return { text: 'grid.noStacks', action: 'showAll' };
  }
  // Всё, что есть в инвентаре, скрыто как непередаваемое, и больше ничего сетку не сужает.
  if (
    filter.show === 'all' &&
    !filter.search.trim() &&
    filter.categories.length === 0 &&
    !filter.untradable &&
    inventory.skins.every(isInert)
  ) {
    return { text: 'grid.onlyUntradable', action: 'showUntradable' };
  }
  // Поиск и отметки типов нашли только скрытые непередаваемые: «ничего нет» было бы неправдой.
  if (!filter.untradable && inventory.skins.some((skin) => isInert(skin) && matches(skin, { ...filter, untradable: true }))) {
    return { text: 'grid.onlyHiddenMatch', action: 'showUntradable' };
  }
  return { text: 'grid.nothingFound', action: 'reset' };
}

/** Кнопка плашки ошибки: «Вставить токен», «Повторить» (перечитать инвентарь) или «Закрыть»; null — плашки нет. */
export type BannerAction = 'newToken' | 'retry' | 'dismiss';

export function bannerActionOf(tokenExpired: boolean, error: UiError | null): BannerAction | null {
  if (tokenExpired) return 'newToken';
  if (!error) return null;
  // Масштаб к инвентарю отношения не имеет: перечитывать его незачем, плашку закрывают (или она уходит сама).
  return error.code === 'zoomFailed' ? 'dismiss' : 'retry';
}

/** Пока идёт запуск или чтение, «Повторить» и «Вставить токен» не работают; «Закрыть» можно всегда. */
export const bannerBusy = (panel: Panel, loading: boolean): boolean => panel.kind === 'running' || loading;

export type GridKey = { kind: 'move'; delta: number } | { kind: 'pick'; mode: SelectMode } | { kind: 'swallow' };

/**
 * Что делает клавиша на карточке; `null` — клавиша не сетки. Пробел и Enter с автоповтором проглатываются:
 * удержание пробела иначе переключало бы выбор десятки раз в секунду. Стрелки повторяются.
 */
export function gridKey(key: string, shift: boolean, repeat: boolean, cols: number, count: number): GridKey | null {
  const moves: Record<string, number> = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: cols,
    ArrowUp: -cols,
    PageDown: cols * 3,
    PageUp: -cols * 3,
    Home: -count,
    End: count,
  };
  if (Object.hasOwn(moves, key)) return { kind: 'move', delta: moves[key] };
  if (key !== ' ' && key !== 'Enter') return null;
  if (repeat) return { kind: 'swallow' };
  if (key === 'Enter') return { kind: 'pick', mode: 'single' };
  return { kind: 'pick', mode: shift ? 'range' : 'toggle' };
}

/** Ключ скина, который ядро обрабатывает сейчас: его карточка подсвечена. Вне запуска — пусто. */
export function currentKey(panel: Panel): string {
  return panel.kind === 'running' ? panel.key : '';
}

const NONE: string[] = [];

/** Ключи скинов, чьи шаги уже прошли. Вне запуска — один и тот же пустой массив. */
export function processedKeys(panel: Panel): string[] {
  return panel.kind === 'running' ? panel.processed : NONE;
}

/**
 * Подпись под картинкой: `none` — пусто (карточки нет в плане), `becomes` — «станет …» (ещё не тронута),
 * `now` — её скин обрабатывают сейчас (подсветка и «станет …»), `processed` — «обработано». «Обработано», а не «готово»:
 * часть шагов могла не пройти. Текущий важнее обработанного — ключ может вернуться.
 */
export type CardNote = 'none' | 'becomes' | 'now' | 'processed';

export function cardNote(key: string, planned: boolean, current: string, processed: ReadonlySet<string>): CardNote {
  if (!planned) return 'none';
  if (current !== '' && key === current) return 'now';
  return processed.has(key) ? 'processed' : 'becomes';
}

/** Хэши картинок карточек в порядке сетки, начиная с индекса `from`; одну и ту же подряд не повторяет. */
export function iconsAfter(list: Card[], from: number): string[] {
  const hashes: string[] = [];
  for (let i = from; i < list.length; i++) {
    const icon = list[i].skin.icon;
    if (icon && icon !== hashes[hashes.length - 1]) hashes.push(icon);
  }
  return hashes;
}
