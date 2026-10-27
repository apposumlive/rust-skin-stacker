import { beforeEach, describe, expect, it } from 'vitest';
import { setLang } from './i18n';
import {
  apartRecords, canCombine, categoriesOf, clampCount, counts, defaultFilter, layoutOf, layoutText, nextSelection,
  pillsOf, splitCapacity, totals, visibleSkins,
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

describe('model', () => {
  beforeEach(() => setLang('ru'));

  it('describes the layout of a skin', () => {
    const s = skin('A', [5, 1, 4, 1]);
    expect(layoutOf(s)).toEqual({ stacks: [5, 4], singles: 2 });
    expect(splitCapacity(s)).toBe(7);
    expect(canCombine(s)).toBe(true);
    expect(canCombine(skin('B', [3]))).toBe(false);
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

  it('makes at most three stack pills', () => {
    expect(pillsOf({ stacks: [9, 8, 7, 6, 5], singles: 3 })).toEqual([
      { text: '×9', stack: true },
      { text: '×8', stack: true },
      { text: '×7', stack: true },
      { text: '+2', stack: true },
      { text: '3\u00a0по одному', stack: false },
    ]);
  });

  it('filters by search, show and type, then sorts', () => {
    const i = inv([skin('Alpha', [1]), skin('Bravo', [3, 1]), skin('Charlie', [2], 'steamcat.clothing'), skin('Delta', [1, 1])]);
    const f = defaultFilter();
    expect(visibleSkins(i, f).map((s) => s.key)).toEqual(['Bravo', 'Charlie', 'Delta', 'Alpha']);
    expect(visibleSkins(i, { ...f, show: 'stacks' }).map((s) => s.key)).toEqual(['Bravo', 'Charlie']);
    expect(visibleSkins(i, { ...f, show: 'dupes' }).map((s) => s.key)).toEqual(['Bravo', 'Delta']);
    expect(visibleSkins(i, { ...f, categories: ['steamcat.clothing'] }).map((s) => s.key)).toEqual(['Charlie']);
    expect(visibleSkins(i, { ...f, search: 'ALP' }).map((s) => s.key)).toEqual(['Alpha']);
    expect(visibleSkins(i, { ...f, sort: 'name' }).map((s) => s.key)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
  });

  it('shows under «Можно собрать» and counts only items whose entries combine', () => {
    const apart: Skin = { ...skin('Apart', []), records: [rec('a1', 2), rec('a2', 1, '9')], total: 3 };
    const mixed: Skin = { ...skin('Mixed', []), records: [rec('m1', 3), rec('m2', 2, '9'), rec('m3', 1)], total: 6 };
    const i = inv([apart, skin('Single', [4]), skin('Pair', [2, 1]), mixed]);
    expect(canCombine(apart)).toBe(false);
    expect(canCombine(mixed)).toBe(true);
    expect(visibleSkins(i, { ...defaultFilter(), show: 'dupes' }).map((s) => s.key)).toEqual(['Mixed', 'Pair']);
    expect(counts(i)).toEqual({ all: 4, stacks: 4, dupes: 2 });
  });

  it('counts filters and totals', () => {
    const i: Inventory = { skins: [skin('A', [5, 1]), skin('B', [1]), skin('C', [1, 1])], unreadable: [{ assetid: null, amount: 2 }] };
    expect(counts(i)).toEqual({ all: 3, stacks: 1, dupes: 2 });
    expect(totals(i)).toEqual({ items: 11, records: 6, stacks: 1, unreadable: 1 });
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
