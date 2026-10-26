// Чистые решения сетки: заголовок, пустое состояние, клавиши карточки. Их проверяют тесты.

import { tn } from '../i18n';
import type { Filter, SelectMode, Show } from '../model';
import type { Panel } from '../store';
import type { Inventory } from '../types';

/** Заголовок сетки по тому, что в ней сейчас: «40 предметов», «16 предметов в стопках», «5 дублей». */
export function gridMeta(show: Show, count: number): string {
  return tn(`grid.meta.${show}`, count);
}

export interface EmptyState {
  /** Ключ текста. */
  text: string;
  /** Кнопка под текстом: «Показать все», «Сбросить фильтры» или никакой. */
  action: 'showAll' | 'reset' | null;
}

/** Что сказать, когда в сетке пусто. Пустой инвентарь — без кнопки: фильтры тут ни при чём. */
export function emptyStateOf(inventory: Inventory, filter: Filter): EmptyState {
  if (inventory.skins.length === 0) return { text: 'grid.empty', action: null };
  if (filter.show === 'stacks' && !filter.search.trim() && filter.categories.length === 0) {
    return { text: 'grid.noStacks', action: 'showAll' };
  }
  return { text: 'grid.nothingFound', action: 'reset' };
}

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
