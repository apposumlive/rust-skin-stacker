// Чистые функции над инвентарём: фильтр, сортировка, раскладка, выбор.

import { fmtInt } from './format';
import { t, tn } from './i18n';
import type { Category, CardAfter, Inventory, InvRecord, Skin } from './types';

export type Show = 'all' | 'stacks' | 'dupes';
export type Sort = 'amount' | 'name';

export interface Filter {
  search: string;
  show: Show;
  categories: string[];
  sort: Sort;
  /** Показывать ли скины, которые нельзя передать и с которыми нечего делать (`isInert`). */
  untradable: boolean;
}

export interface Layout {
  stacks: number[];
  singles: number;
}

/** Карточка сетки: одна запись инвентаря и её скин. */
export interface Card {
  skin: Skin;
  record: InvRecord;
}

export interface Counts {
  all: number;
  stacks: number;
  dupes: number;
  /** Записей скинов, с которыми нечего делать (`isInert`): всегда полное число, фильтр на него не влияет. */
  inert: number;
}

export interface Totals {
  items: number;
  records: number;
  stacks: number;
  unreadable: number;
  /** Штук у скинов, с которыми нечего делать (`isInert`). */
  untradable: number;
}

export interface Selection {
  selected: string[];
  anchor: string | null;
}

export type SelectMode = 'single' | 'toggle' | 'range';

/** Фильтр при открытии окна: все предметы, больше всего штук сверху. */
export function defaultFilter(): Filter {
  return { search: '', show: 'all', categories: [], sort: 'amount', untradable: false };
}

export const hasStack = (skin: Skin): boolean => skin.records.some((r) => r.amount > 1);

/** Число для «Отделить N»: целое от 1 до `capacity`. Дробное округляется, не число и меньше 1 — это 1. */
export function clampCount(value: number, capacity: number): number {
  const n = Math.round(value) || 1;
  return Math.min(Math.max(1, capacity), Math.max(1, n));
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

/**
 * Нельзя передать и делать с ним нечего: дропы Twitch и подобные. Скин с ключом `class:…` Steam прислал без описания:
 * торговый статус неизвестен, такой не прячем.
 */
export function isInert(skin: Skin): boolean {
  if (skin.key.startsWith('class:')) return false;
  const locked = skin.records.length > 0 && skin.records.every((r) => !r.tradable && r.availableAfter === null);
  return locked && !hasStack(skin) && !canCombine(skin);
}

/** Записи, которые не соберутся с основной стопкой: у них другие classid или instanceid. */
export function apartRecords(skin: Skin): InvRecord[] {
  const main = skin.records[0];
  if (!main) return [];
  return skin.records.filter((r) => r.classid !== main.classid || r.instanceid !== main.instanceid);
}

export function matches(skin: Skin, filter: Filter): boolean {
  if (!filter.untradable && isInert(skin)) return false;
  if (filter.show === 'stacks' && !hasStack(skin)) return false;
  if (filter.show === 'dupes' && !canCombine(skin)) return false;
  if (filter.categories.length > 0 && !(skin.category && filter.categories.includes(skin.category.id))) return false;
  const query = filter.search.trim().toLocaleLowerCase();
  return !query || skin.name.toLocaleLowerCase().includes(query) || skin.key.toLocaleLowerCase().includes(query);
}

/** Скины, подходящие фильтру: по total, затем по имени («По имени» — только по имени). */
function filteredSkins(inventory: Inventory, filter: Filter): Skin[] {
  const byName = (a: Skin, b: Skin) => a.name.localeCompare(b.name);
  const byAmount = (a: Skin, b: Skin) => b.total - a.total || byName(a, b);
  return inventory.skins.filter((s) => matches(s, filter)).sort(filter.sort === 'name' ? byName : byAmount);
}

/** В скине есть другая запись того же classid и instanceid: эту можно собрать с ней. */
export function combinable(skin: Skin, record: InvRecord): boolean {
  return skin.records.some((r) => r !== record && r.classid === record.classid && r.instanceid === record.instanceid);
}

/** Карточки сетки: скины как в фильтре, внутри скина — записи в его порядке. «Стопки» и «Можно собрать» отбирают записи. */
export function visibleCards(inventory: Inventory, filter: Filter): Card[] {
  const cards: Card[] = [];
  for (const skin of filteredSkins(inventory, filter)) {
    for (const record of skin.records) {
      if (filter.show === 'stacks' && record.amount <= 1) continue;
      if (filter.show === 'dupes' && !combinable(skin, record)) continue;
      cards.push({ skin, record });
    }
  }
  return cards;
}

export function counts(inventory: Inventory, filter: Filter): Counts {
  const result: Counts = { all: 0, stacks: 0, dupes: 0, inert: 0 };
  for (const skin of inventory.skins) {
    const inert = isInert(skin);
    if (inert) result.inert += skin.records.length;
    if (!inert || filter.untradable) result.all += skin.records.length;
    for (const record of skin.records) {
      if (record.amount > 1) result.stacks += 1;
      if (combinable(skin, record)) result.dupes += 1;
    }
  }
  return result;
}

export function totals(inventory: Inventory): Totals {
  let items = 0;
  let records = 0;
  let stacks = 0;
  let untradable = 0;
  for (const skin of inventory.skins) {
    items += skin.total;
    records += skin.records.length;
    stacks += skin.records.filter((r) => r.amount > 1).length;
    if (isInert(skin)) untradable += skin.total;
  }
  const unreadable = inventory.unreadable.reduce((n, u) => n + u.amount, 0);
  return {
    items: items + unreadable,
    records: records + inventory.unreadable.length,
    stacks,
    unreadable: inventory.unreadable.length,
    untradable,
  };
}

/**
 * Строки итогов слева: ключ подписи и число. Значения — только числа, без «шт.»: так столбец справа ровный,
 * а единица стоит в подписи («Всего штук»). «Нельзя передать» и «Нечитаемых» — только если такие есть.
 */
export function statLines(sum: Totals): Array<{ key: string; value: number }> {
  const lines = [
    { key: 'stats.total', value: sum.items },
    { key: 'stats.records', value: sum.records },
    { key: 'stats.stacks', value: sum.stacks },
  ];
  if (sum.untradable) lines.push({ key: 'stats.untradable', value: sum.untradable });
  if (sum.unreadable) lines.push({ key: 'stats.unreadable', value: sum.unreadable });
  return lines;
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

/** Раскладка карточки после операции: стопка или одна штука. */
export function cardLayout(c: CardAfter): Layout {
  return { stacks: c.amount > 1 ? [c.amount] : [], singles: c.singles + (c.amount === 1 ? 1 : 0) };
}

/** Среди карточек есть стопка: её можно разделить. */
export const canSplitCards = (cards: Card[]): boolean => cards.some((c) => c.record.amount > 1);

/** Среди карточек есть группа (скин, classid, instanceid) из двух и больше: её можно собрать. */
export function canCombineCards(cards: Card[]): boolean {
  const seen = new Set<string>();
  for (const { skin, record } of cards) {
    const group = `${skin.key}/${record.classid}/${record.instanceid}`;
    if (seen.has(group)) return true;
    seen.add(group);
  }
  return false;
}
