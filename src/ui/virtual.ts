// Расчёт видимых рядов виртуальной сетки. Чистые функции — их проверяют тесты.

/** Совпадает с --card-h в styles/tokens.css. */
export const CARD_HEIGHT = 192;
export const GAP = 12;
export const MIN_CARD_WIDTH = 168;

export interface Range {
  /** Индексы карточек [first, last). */
  first: number;
  last: number;
  /** Сдвиг первого нарисованного ряда. */
  padTop: number;
  /** Полная высота сетки. */
  total: number;
}

export function columnsFor(width: number, minCard = MIN_CARD_WIDTH, gap = GAP): number {
  return Math.max(1, Math.floor((width + gap) / (minCard + gap)));
}

export function visibleRange(
  count: number,
  cols: number,
  rowHeight: number,
  scrollTop: number,
  viewport: number,
  overscan = 2,
): Range {
  const rows = Math.ceil(count / cols);
  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const lastRow = Math.min(rows, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  return {
    first: Math.min(count, firstRow * cols),
    last: Math.min(count, lastRow * cols),
    padTop: firstRow * rowHeight,
    total: rows * rowHeight,
  };
}
