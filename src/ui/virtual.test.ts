import { describe, expect, it } from 'vitest';
import { GAP, MIN_CARD_WIDTH, columnsFor, visibleRange, windowDiff } from './virtual';

describe('virtual grid', () => {
  it('fits as many columns as the width allows', () => {
    expect(columnsFor(712)).toBe(4);
    expect(columnsFor(100)).toBe(1);
    expect(columnsFor(0)).toBe(1);
  });

  it('switches columns exactly where the card width allows', () => {
    // Ширина n колонок: n * 160 + (n - 1) * 12.
    expect(columnsFor(676)).toBe(4);
    expect(columnsFor(675)).toBe(3);
    expect(columnsFor(504)).toBe(3);
    expect(columnsFor(503)).toBe(2);
    expect(columnsFor(332)).toBe(2);
    expect(columnsFor(331)).toBe(1);
    expect(columnsFor(160)).toBe(1);
    expect(columnsFor(159)).toBe(1);
  });

  it('keeps 4 columns at 1280 px and 2 at the 1024 px minimum', () => {
    // Окно минус колонка фильтров (200), правая панель (340), поля .content (2 × 18) и полоса прокрутки (≈10).
    const scroller = (window: number) => window - 200 - 340 - 2 * 18 - 10;
    expect(MIN_CARD_WIDTH).toBe(160);
    expect(GAP).toBe(12);
    expect(columnsFor(scroller(1280))).toBe(4);
    expect(columnsFor(scroller(1024))).toBe(2);
  });

  it('takes the card width and the gap from the arguments', () => {
    expect(columnsFor(1000, 100, 0)).toBe(10);
    expect(columnsFor(1000, 100, 20)).toBe(8);
    expect(columnsFor(939, 100, 20)).toBe(7);
    expect(columnsFor(940, 100, 20)).toBe(8);
    expect(columnsFor(50, 100, 20)).toBe(1);
  });

  it('renders the visible rows plus two spare rows', () => {
    expect(visibleRange(5000, 4, 204, 0, 600)).toEqual({ first: 0, last: 20, padTop: 0, total: 255000 });
    expect(visibleRange(5000, 4, 204, 2040, 600)).toEqual({ first: 32, last: 60, padTop: 1632, total: 255000 });
  });

  it('stops at the end of the list', () => {
    const r = visibleRange(5000, 4, 204, 255000 - 600, 600);
    expect(r.last).toBe(5000);
    expect(r.first).toBe(4980);
    expect(visibleRange(10, 4, 204, 0, 5000)).toEqual({ first: 0, last: 10, padTop: 0, total: 612 });
  });

  it('handles an empty list', () => {
    expect(visibleRange(0, 4, 204, 0, 600)).toEqual({ first: 0, last: 0, padTop: 0, total: 0 });
    expect(visibleRange(0, 4, 204, 9999, 600)).toEqual({ first: 0, last: 0, padTop: 0, total: 0 });
  });

  it('draws a short list that has fewer items than columns', () => {
    expect(visibleRange(3, 4, 204, 0, 600)).toEqual({ first: 0, last: 3, padTop: 0, total: 204 });
    expect(visibleRange(3, 4, 204, 500, 600)).toEqual({ first: 0, last: 3, padTop: 0, total: 204 });
  });

  it('treats a scroll position past the end like the end of the list', () => {
    const end = visibleRange(5000, 4, 204, 255000 - 600, 600);
    expect(visibleRange(5000, 4, 204, 255000 + 1, 600)).toEqual(end);
    expect(visibleRange(5000, 4, 204, 10_000_000, 600)).toEqual(end);
  });

  it('does not blank the grid when the list shrinks while scrolled down', () => {
    // Список был в 5000 записей, прокрутка стояла у конца; теперь в нём 100 записей.
    const r = visibleRange(100, 4, 204, 255000 - 600, 600);
    expect(r).toEqual({ first: 80, last: 100, padTop: 4080, total: 5100 });
    // То же, когда колонок стало больше: 100 записей в 2 колонки → в 4.
    const wide = visibleRange(100, 4, 204, 50 * 204 - 600, 600);
    expect(wide.first).toBeLessThan(wide.last);
    expect(wide.last).toBe(100);
  });

  it('treats a negative scroll position like zero', () => {
    expect(visibleRange(5000, 4, 204, -300, 600)).toEqual(visibleRange(5000, 4, 204, 0, 600));
    expect(visibleRange(3, 4, 204, -1, 600)).toEqual(visibleRange(3, 4, 204, 0, 600));
  });

  it('never returns an empty range for a non-empty list', () => {
    for (const count of [1, 3, 4, 5, 17, 100, 5000]) {
      for (const cols of [1, 2, 3, 4, 5]) {
        for (const scrollTop of [-50, 0, 500, 5000, 1_000_000]) {
          for (const viewport of [0, 300, 600]) {
            const r = visibleRange(count, cols, 204, scrollTop, viewport);
            expect(r.first).toBeGreaterThanOrEqual(0);
            expect(r.first).toBeLessThan(r.last);
            expect(r.last).toBeLessThanOrEqual(count);
            expect(r.first % cols).toBe(0);
          }
        }
      }
    }
  });
});

describe('window diff', () => {
  it('changes nothing while the window stays put', () => {
    expect(windowDiff({ first: 8, last: 28 }, { first: 8, last: 28 })).toEqual({ remove: [], add: [] });
    expect(windowDiff({ first: 0, last: 0 }, { first: 0, last: 0 })).toEqual({ remove: [], add: [] });
  });

  it('creates every card when nothing is drawn yet', () => {
    expect(windowDiff(null, { first: 4, last: 8 })).toEqual({ remove: [], add: [4, 5, 6, 7] });
    expect(windowDiff(null, { first: 0, last: 0 })).toEqual({ remove: [], add: [] });
  });

  it('keeps the cards that stay when scrolling down by a row', () => {
    expect(windowDiff({ first: 0, last: 8 }, { first: 4, last: 12 })).toEqual({ remove: [0, 1, 2, 3], add: [8, 9, 10, 11] });
  });

  it('keeps the cards that stay when scrolling up by a row', () => {
    expect(windowDiff({ first: 4, last: 12 }, { first: 0, last: 8 })).toEqual({ remove: [8, 9, 10, 11], add: [0, 1, 2, 3] });
  });

  it('adds only the new cards when the window grows', () => {
    expect(windowDiff({ first: 4, last: 8 }, { first: 0, last: 12 })).toEqual({ remove: [], add: [0, 1, 2, 3, 8, 9, 10, 11] });
  });

  it('replaces everything after a jump', () => {
    expect(windowDiff({ first: 0, last: 4 }, { first: 100, last: 104 })).toEqual({
      remove: [0, 1, 2, 3],
      add: [100, 101, 102, 103],
    });
  });

  it('removes everything when the list becomes empty', () => {
    expect(windowDiff({ first: 0, last: 3 }, { first: 0, last: 0 })).toEqual({ remove: [0, 1, 2], add: [] });
  });
});
