import { beforeEach, describe, expect, it } from 'vitest';
import { setLang } from './i18n';
import {
  apartRecords, canCombine, canCombineCards, canSplitCards, cardLayout, categoriesOf, clampCount, combinable, counts, defaultFilter,
  isInert, layoutText, matches, nextSelection, statLines, totals, visibleCards, type Card,
} from './model';
import type { Inventory, InvRecord, Skin } from './types';

function rec(assetid: string, amount: number, instanceid = '0'): InvRecord {
  return { assetid, classid: 'c1', instanceid, amount, tradable: true, marketable: true, availableAfter: null };
}

function skin(key: string, amounts: number[], category = 'steamcat.weapon'): Skin {
  const records = amounts.map((a, i) => rec(`${key}-${i}`, a)).sort((a, b) => b.amount - a.amount);
  return { key, name: key, icon: null, category: { id: category, label: category }, total: amounts.reduce((a, b) => a + b, 0), records };
}

const inv = (skins: Skin[]): Inventory => ({ skins, unreadable: [] });
const ids = (cards: Card[]) => cards.map((c) => c.record.assetid);
/** Ключи скинов карточек по порядку, без повторов. */
const keysOf = (cards: Card[]) => [...new Set(cards.map((c) => c.skin.key))];

describe('model', () => {
  beforeEach(() => setLang('ru'));

  it('tells whether a skin has entries that combine', () => {
    expect(canCombine(skin('A', [5, 1, 4, 1]))).toBe(true);
    expect(canCombine(skin('B', [3]))).toBe(false);
  });

  it('finds the entries that combine with another entry of the same skin', () => {
    const s: Skin = { ...skin('A', []), records: [rec('1', 3), rec('2', 2, '9'), rec('3', 1)], total: 6 };
    expect(s.records.map((r) => combinable(s, r))).toEqual([true, false, true]);
    const lone = skin('B', [3]);
    expect(combinable(lone, lone.records[0])).toBe(false);
  });

  it('lays out a card after an operation', () => {
    expect(cardLayout({ assetid: 'a', amount: 7, singles: 3 })).toEqual({ stacks: [7], singles: 3 });
    expect(cardLayout({ assetid: 'a', amount: 1, singles: 4 })).toEqual({ stacks: [], singles: 5 });
    expect(cardLayout({ assetid: 'a', amount: 12, singles: 0 })).toEqual({ stacks: [12], singles: 0 });
  });

  it('can split cards when one of them is a stack', () => {
    const [a, b] = visibleCards(inv([skin('A', [3, 1])]), defaultFilter());
    expect(canSplitCards([a])).toBe(true);
    expect(canSplitCards([b])).toBe(false);
    expect(canSplitCards([])).toBe(false);
  });

  it('can combine cards only when two of them share a skin and a type', () => {
    const a = skin('A', [3, 1]);
    const other: Skin = { ...skin('B', []), records: [rec('b1', 2), rec('b2', 1, '9')], total: 3 };
    const cards = visibleCards(inv([a, other]), defaultFilter());
    const by = (id: string) => cards.find((c) => c.record.assetid === id)!;
    expect(canCombineCards([by('A-0'), by('A-1')])).toBe(true);
    // Один скин, но разные типы; один тип, но разные скины.
    expect(canCombineCards([by('b1'), by('b2')])).toBe(false);
    expect(canCombineCards([by('A-0'), by('b1')])).toBe(false);
    expect(canCombineCards([by('A-0')])).toBe(false);
    expect(canCombineCards([])).toBe(false);
  });

  it('finds entries that will not combine with the main stack', () => {
    const s: Skin = { ...skin('A', []), records: [rec('1', 3), rec('2', 2, '9'), rec('3', 1)], total: 6 };
    expect(apartRecords(s).map((r) => r.assetid)).toEqual(['2']);
  });

  it('writes layouts in words', () => {
    expect(layoutText([6], 2, true)).toBe('стопка ×6 и 2\u00a0по одному');
    expect(layoutText([5, 4], 3, true)).toBe('стопки ×5, ×4 и 3\u00a0по одному');
    expect(layoutText([], 12, false)).toBe('12\u00a0по одному');
    expect(layoutText([10], 0, false)).toBe('×10');
    setLang('en');
    expect(layoutText([6], 2, true)).toBe('stack ×6 and 2\u00a0singles');
  });

  it('makes a card per entry: skins by total then name, entries in the skin order', () => {
    const i = inv([skin('Alpha', [1]), skin('Bravo', [3, 1]), skin('Charlie', [2], 'steamcat.clothing'), skin('Delta', [1, 1])]);
    const f = defaultFilter();
    expect(f).toEqual({ search: '', show: 'all', categories: [], sort: 'amount', untradable: false });
    expect(ids(visibleCards(i, f))).toEqual(['Bravo-0', 'Bravo-1', 'Charlie-0', 'Delta-0', 'Delta-1', 'Alpha-0']);
    expect(ids(visibleCards(i, { ...f, sort: 'name' }))).toEqual(['Alpha-0', 'Bravo-0', 'Bravo-1', 'Charlie-0', 'Delta-0', 'Delta-1']);
    expect(ids(visibleCards(i, { ...f, show: 'stacks' }))).toEqual(['Bravo-0', 'Charlie-0']);
    expect(ids(visibleCards(i, { ...f, show: 'dupes' }))).toEqual(['Bravo-0', 'Bravo-1', 'Delta-0', 'Delta-1']);
    expect(ids(visibleCards(i, { ...f, categories: ['steamcat.clothing'] }))).toEqual(['Charlie-0']);
    expect(ids(visibleCards(i, { ...f, search: 'ALP' }))).toEqual(['Alpha-0']);
    expect(visibleCards(i, f)[0].skin).toBe(i.skins[1]);
  });

  it('shows under «Можно собрать» and counts only entries that combine', () => {
    const apart: Skin = { ...skin('Apart', []), records: [rec('a1', 2), rec('a2', 1, '9')], total: 3 };
    const mixed: Skin = { ...skin('Mixed', []), records: [rec('m1', 3), rec('m2', 2, '9'), rec('m3', 1)], total: 6 };
    const i = inv([apart, skin('Single', [4]), skin('Pair', [2, 1]), mixed]);
    expect(canCombine(apart)).toBe(false);
    expect(canCombine(mixed)).toBe(true);
    expect(ids(visibleCards(i, { ...defaultFilter(), show: 'dupes' }))).toEqual(['m1', 'm3', 'Pair-0', 'Pair-1']);
    expect(counts(i, defaultFilter())).toEqual({ all: 8, stacks: 5, dupes: 4, inert: 0 });
  });

  it('counts filters and totals', () => {
    const i: Inventory = { skins: [skin('A', [5, 1]), skin('B', [1]), skin('C', [1, 1])], unreadable: [{ assetid: null, amount: 2 }] };
    expect(counts(i, defaultFilter())).toEqual({ all: 5, stacks: 1, dupes: 4, inert: 0 });
    expect(totals(i)).toEqual({ items: 11, records: 6, stacks: 1, unreadable: 1, untradable: 0 });
  });

  it('lists the totals as plain numbers: the column of values lines up', () => {
    expect(statLines({ items: 438, records: 438, stacks: 0, unreadable: 0, untradable: 433 })).toEqual([
      { key: 'stats.total', value: 438 },
      { key: 'stats.records', value: 438 },
      { key: 'stats.stacks', value: 0 },
      { key: 'stats.untradable', value: 433 },
    ]);
    expect(statLines({ items: 11, records: 6, stacks: 1, unreadable: 1, untradable: 0 })).toEqual([
      { key: 'stats.total', value: 11 },
      { key: 'stats.records', value: 6 },
      { key: 'stats.stacks', value: 1 },
      { key: 'stats.unreadable', value: 1 },
    ]);
  });

  it('lists categories once, sorted by label', () => {
    const i = inv([skin('A', [1], 'b'), skin('B', [1], 'a'), skin('C', [1], 'b')]);
    expect(categoriesOf(i).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('selects single, toggles and ranges', () => {
    const order = ['a', 'b', 'c', 'd'];
    let sel = nextSelection({ selected: [], anchor: null }, 'b', 'single', order);
    expect(sel).toEqual({ selected: ['b'], anchor: 'b' });
    sel = nextSelection(sel, 'd', 'toggle', order);
    expect(sel.selected).toEqual(['b', 'd']);
    sel = nextSelection(sel, 'd', 'toggle', order);
    expect(sel.selected).toEqual(['b']);
    sel = nextSelection({ selected: ['b'], anchor: 'b' }, 'd', 'range', order);
    expect(sel).toEqual({ selected: ['b', 'c', 'd'], anchor: 'b' });
    sel = nextSelection({ selected: ['c'], anchor: 'c' }, 'a', 'range', order);
    expect(sel.selected).toEqual(['a', 'b', 'c']);
    expect(nextSelection({ selected: [], anchor: null }, 'c', 'range', order)).toEqual({ selected: ['c'], anchor: 'c' });
  });

  it('clamps the split-off count to 1..capacity', () => {
    expect(clampCount(4, 8)).toBe(4);
    expect(clampCount(1, 8)).toBe(1);
    expect(clampCount(8, 8)).toBe(8);
    // Не целые числа округляются.
    expect(clampCount(2.4, 8)).toBe(2);
    expect(clampCount(2.5, 8)).toBe(3);
    expect(clampCount(7.6, 8)).toBe(8);
    // Меньше единицы и не число — единица.
    expect(clampCount(0, 8)).toBe(1);
    expect(clampCount(0.4, 8)).toBe(1);
    expect(clampCount(-3, 8)).toBe(1);
    expect(clampCount(Number.NaN, 8)).toBe(1);
    expect(clampCount(Number.NEGATIVE_INFINITY, 8)).toBe(1);
    // Больше вместимости — вместимость.
    expect(clampCount(9, 8)).toBe(8);
    expect(clampCount(1e9, 8)).toBe(8);
    expect(clampCount(Number.POSITIVE_INFINITY, 8)).toBe(8);
    // Вместимость 1 (или меньше): выбирать не из чего.
    expect(clampCount(5, 1)).toBe(1);
    expect(clampCount(1, 1)).toBe(1);
    expect(clampCount(3, 0)).toBe(1);
  });
});

describe('untradable items with nothing to do', () => {
  /** Запись, которую нельзя передать и продать. */
  const locked = (assetid: string, amount = 1, over: Partial<InvRecord> = {}): InvRecord => ({
    ...rec(assetid, amount),
    tradable: false,
    marketable: false,
    ...over,
  });
  const skinOf = (key: string, records: InvRecord[]): Skin => ({
    ...skin(key, []),
    records,
    total: records.reduce((n, r) => n + r.amount, 0),
  });

  const drop = skinOf('Drop', [locked('d1')]);
  const drop2 = skinOf('Drop2', [locked('e1')]);
  const later = skinOf('Later', [locked('l1', 1, { availableAfter: '2026-11-02T07:00:00Z' })]);
  const lockedStack = skinOf('LockedStack', [locked('s1', 3)]);
  const lockedPair = skinOf('LockedPair', [locked('p1'), locked('p2')]);
  const mixed = skinOf('Mixed', [locked('m1'), { ...rec('m2', 1, '9') }]);
  const plain = skin('Plain', [1]);
  const i = inv([drop, drop2, later, lockedStack, lockedPair, mixed, plain]);
  const shown = { ...defaultFilter(), untradable: true };

  it('is inert only when every entry is locked for good and there is no stack and no pair', () => {
    expect(isInert(drop)).toBe(true);
    // Несколько записей, которые нельзя передать и которые не собираются между собой, — тоже ничего не сделать.
    expect(isInert(skinOf('Odd', [locked('o1'), locked('o2', 1, { instanceid: '7' })]))).toBe(true);
  });

  it('is not inert while the lock has an end date', () => {
    expect(isInert(later)).toBe(false);
    // Одна запись с датой, другая без: скин ещё вернётся к обмену.
    expect(isInert(skinOf('Half', [locked('h1'), locked('h2', 1, { instanceid: '7', availableAfter: '2026-11-02T07:00:00Z' })]))).toBe(false);
  });

  it('is not inert when there is a stack or a pair to work with', () => {
    expect(isInert(lockedStack)).toBe(false);
    expect(isInert(lockedPair)).toBe(false);
  });

  it('is not inert when something can be traded', () => {
    expect(isInert(plain)).toBe(false);
    expect(isInert(mixed)).toBe(false);
  });

  it('is not inert without entries', () => {
    expect(isInert({ ...drop, records: [], total: 0 })).toBe(false);
  });

  it('is not inert when Steam sent no description: its trade status is unknown, so it stays in the grid', () => {
    // Без описания ядро даёт ключ `class:<classid>`, а записи выглядят как непередаваемые без даты.
    const unknown: Skin = { ...skinOf('class:c7', [locked('u1')]), name: 'classid c7' };
    expect(isInert(unknown)).toBe(false);
    expect(matches(unknown, defaultFilter())).toBe(true);
    expect(counts(inv([unknown, drop]), defaultFilter())).toEqual({ all: 1, stacks: 0, dupes: 0, inert: 1 });
    expect(totals(inv([unknown])).untradable).toBe(0);
    // Ключ, где `class:` не в начале, — обычное название из Steam.
    expect(isInert(skinOf('First class: Drop', [locked('g1')]))).toBe(true);
  });

  it('hides inert items unless the switch is on, and keeps the other conditions', () => {
    expect(matches(drop, defaultFilter())).toBe(false);
    expect(matches(drop, shown)).toBe(true);
    expect(matches(plain, defaultFilter())).toBe(true);
    expect(matches(later, defaultFilter())).toBe(true);
    expect(keysOf(visibleCards(i, defaultFilter()))).toEqual(['LockedStack', 'LockedPair', 'Mixed', 'Later', 'Plain']);
    expect(keysOf(visibleCards(i, shown))).toEqual(['LockedStack', 'LockedPair', 'Mixed', 'Drop', 'Drop2', 'Later', 'Plain']);
    // Поиск, «Показать» и тип работают поверх переключателя.
    expect(keysOf(visibleCards(i, { ...defaultFilter(), search: 'drop' }))).toEqual([]);
    expect(keysOf(visibleCards(i, { ...shown, search: 'drop' }))).toEqual(['Drop', 'Drop2']);
    expect(keysOf(visibleCards(i, { ...shown, show: 'stacks' }))).toEqual(['LockedStack']);
    expect(keysOf(visibleCards(i, { ...shown, show: 'dupes' }))).toEqual(['LockedPair']);
    expect(keysOf(visibleCards(i, { ...shown, categories: ['steamcat.clothing'] }))).toEqual([]);
  });

  it('counts «All» without the hidden entries and always counts the inert ones in full', () => {
    expect(counts(i, defaultFilter())).toEqual({ all: 7, stacks: 1, dupes: 2, inert: 2 });
    expect(counts(i, shown)).toEqual({ all: 9, stacks: 1, dupes: 2, inert: 2 });
  });

  it('counts the pieces of inert items in the totals, and everything else as before', () => {
    expect(totals(i)).toEqual({ items: 11, records: 9, stacks: 1, unreadable: 0, untradable: 2 });
    expect(totals(inv([plain, lockedStack])).untradable).toBe(0);
    expect(totals(inv([skinOf('Odd', [locked('o1'), locked('o2', 1, { instanceid: '7' })])])).untradable).toBe(2);
  });
});
