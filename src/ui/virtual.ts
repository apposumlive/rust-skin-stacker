// Расчёт видимых рядов виртуальной сетки. Чистые функции — их проверяют тесты.

/** Совпадает с --card-h в styles/tokens.css. */
export const CARD_HEIGHT = 168;
export const GAP = 12;
/** Как на макете: при окне 1280 px в сетку (≈694 px с полосой прокрутки) входят 4 колонки, при 1024 px — 2. */
export const MIN_CARD_WIDTH = 160;

export interface Range {
  /** Индексы карточек [first, last). */
  first: number;
  last: number;
  /** Сдвиг первого нарисованного ряда. */
  padTop: number;
  /** Полная высота сетки. */
  total: number;
}

/** Окно карточек [first, last) — часть Range. */
export type Span = Pick<Range, 'first' | 'last'>;

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
  // Прокрутка могла остаться ниже конца: список стал короче или колонок стало больше.
  const top = Math.min(Math.max(0, scrollTop), Math.max(0, rows * rowHeight - viewport));
  const firstRow = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const lastRow = Math.min(rows, Math.ceil((top + viewport) / rowHeight) + overscan);
  return {
    first: Math.min(count, firstRow * cols),
    last: Math.min(count, lastRow * cols),
    padTop: firstRow * rowHeight,
    total: rows * rowHeight,
  };
}

/**
 * Окно сдвинулось с prev на next: какие карточки убрать и какие создать (индексы по возрастанию).
 * Остальные остаются как есть, поэтому их картинки, наведение и фокус не теряются.
 */
export function windowDiff(prev: Span | null, next: Span): { remove: number[]; add: number[] } {
  const remove: number[] = [];
  const add: number[] = [];
  const inPrev = (i: number) => prev !== null && i >= prev.first && i < prev.last;
  if (prev) for (let i = prev.first; i < prev.last; i++) if (i < next.first || i >= next.last) remove.push(i);
  for (let i = next.first; i < next.last; i++) if (!inPrev(i)) add.push(i);
  return { remove, add };
}
