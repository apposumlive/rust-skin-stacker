// Чистые функции над инвентарём: фильтр, сортировка, раскладка, выбор.

import { fmtInt } from './format';
import { t, tn } from './i18n';
import type { Category, Inventory, InvRecord, Skin } from './types';

export type Show = 'all' | 'stacks' | 'dupes';
export type Sort = 'amount' | 'name';

export interface Filter {
  search: string;
  show: Show;
  categories: string[];
  sort: Sort;
}

export interface Layout {
  stacks: number[];
  singles: number;
}

export interface Pill {
  text: string;
  stack: boolean;
}

export interface Counts {
  all: number;
  stacks: number;
  dupes: number;
}

export interface Totals {
  items: number;
  records: number;
  stacks: number;
  unreadable: number;
}

export interface Selection {
  selected: string[];
  anchor: string | null;
}

export type SelectMode = 'single' | 'toggle' | 'range';

/** Фильтр при открытии окна: все предметы, больше всего штук сверху. */
export function defaultFilter(): Filter {
  return { search: '', show: 'all', categories: [], sort: 'amount' };
}

/** Стопки по убыванию и сколько записей лежит по одному. */
export function layoutOf(skin: Skin): Layout {
  const stacks = skin.records.filter((r) => r.amount > 1).map((r) => r.amount).sort((a, b) => b - a);
  return { stacks, singles: skin.records.filter((r) => r.amount === 1).length };
}

export const hasStack = (skin: Skin): boolean => skin.records.some((r) => r.amount > 1);
export const isDupe = (skin: Skin): boolean => skin.records.length > 1;

/** Сколько штук можно отделить по одному: сумма A−1 по стопкам. */
export function splitCapacity(skin: Skin): number {
  return skin.records.reduce((n, r) => n + r.amount - 1, 0);
}

/** Есть хотя бы две записи с одинаковыми classid и instanceid. */
export function canCombine(skin: Skin): boolean {
  const seen = new Set<string>();
  for (const r of skin.records) {
    const type = `${r.classid}/${r.instanceid}`;
    if (seen.has(type)) return true;
    seen.add(type);
  }
  return false;
}

/** Записи, которые не соберутся с основной стопкой: у них другие classid или instanceid. */
export function apartRecords(skin: Skin): InvRecord[] {
  const main = skin.records[0];
  if (!main) return [];
  return skin.records.filter((r) => r.classid !== main.classid || r.instanceid !== main.instanceid);
}

export function matches(skin: Skin, filter: Filter): boolean {
  if (filter.show === 'stacks' && !hasStack(skin)) return false;
  if (filter.show === 'dupes' && !isDupe(skin)) return false;
  if (filter.categories.length > 0 && !(skin.category && filter.categories.includes(skin.category.id))) return false;
  const query = filter.search.trim().toLocaleLowerCase();
  return !query || skin.name.toLocaleLowerCase().includes(query) || skin.key.toLocaleLowerCase().includes(query);
}

export function visibleSkins(inventory: Inventory, filter: Filter): Skin[] {
  const byName = (a: Skin, b: Skin) => a.name.localeCompare(b.name);
  const byAmount = (a: Skin, b: Skin) => b.total - a.total || byName(a, b);
  return inventory.skins.filter((s) => matches(s, filter)).sort(filter.sort === 'name' ? byName : byAmount);
}

export function counts(inventory: Inventory): Counts {
  return {
    all: inventory.skins.length,
    stacks: inventory.skins.filter(hasStack).length,
    dupes: inventory.skins.filter(isDupe).length,
  };
}

export function totals(inventory: Inventory): Totals {
  let items = 0;
  let records = 0;
  let stacks = 0;
  for (const skin of inventory.skins) {
    items += skin.total;
    records += skin.records.length;
    stacks += skin.records.filter((r) => r.amount > 1).length;
  }
  const unreadable = inventory.unreadable.reduce((n, u) => n + u.amount, 0);
  return {
    items: items + unreadable,
    records: records + inventory.unreadable.length,
    stacks,
    unreadable: inventory.unreadable.length,
  };
}

export function categoriesOf(inventory: Inventory): Category[] {
  const byId = new Map<string, Category>();
  for (const skin of inventory.skins) if (skin.category) byId.set(skin.category.id, skin.category);
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Клик — один предмет, Ctrl — добавить или убрать, Shift — диапазон от якоря в порядке сетки. */
export function nextSelection(current: Selection, key: string, mode: SelectMode, order: string[]): Selection {
  if (mode === 'toggle') {
    const has = current.selected.includes(key);
    return { selected: has ? current.selected.filter((k) => k !== key) : [...current.selected, key], anchor: key };
  }
  if (mode === 'range' && current.anchor) {
    const from = order.indexOf(current.anchor);
    const to = order.indexOf(key);
    if (from >= 0 && to >= 0) {
      const [a, b] = from < to ? [from, to] : [to, from];
      return { selected: order.slice(a, b + 1), anchor: current.anchor };
    }
  }
  return { selected: [key], anchor: key };
}

/** «стопка ×6 и 2 по одному»; без слова — «×6 и 2 по одному». */
export function layoutText(stacks: number[], singles: number, withWord: boolean): string {
  const list = stacks.map((n) => `×${fmtInt(n)}`).join(', ');
  const stackPart = stacks.length ? (withWord ? `${tn('layout.stackWord', stacks.length)} ${list}` : list) : '';
  const singlePart = singles ? tn('layout.singles', singles) : '';
  if (stackPart && singlePart) return t('layout.both', { stacks: stackPart, singles: singlePart });
  return stackPart || singlePart;
}

/** Плашки раскладки на карточке: не больше трёх стопок, остальные — «+N». */
export function pillsOf(layout: Layout, max = 3): Pill[] {
  const pills: Pill[] = layout.stacks.slice(0, max).map((n) => ({ text: `×${fmtInt(n)}`, stack: true }));
  if (layout.stacks.length > max) pills.push({ text: `+${layout.stacks.length - max}`, stack: true });
  if (layout.singles) pills.push({ text: tn('layout.singles', layout.singles), stack: false });
  return pills;
}
