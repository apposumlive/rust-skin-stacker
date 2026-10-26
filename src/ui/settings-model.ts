// Чистые правила панели настроек: пауза на сетке ползунка и обход Tab внутри панели.

export const MIN_DELAY = 500;
export const MAX_DELAY = 10_000;
export const STEP = 500;
export const DEFAULT_DELAY = 1500;

/** Пауза, приведённая к сетке ползунка: ближайшее кратное 500 в пределах 500..10 000. Не число — по умолчанию. */
export function snapDelay(ms: number): number {
  if (Number.isNaN(ms)) return DEFAULT_DELAY;
  const snapped = Math.round(ms / STEP) * STEP;
  return Math.min(MAX_DELAY, Math.max(MIN_DELAY, snapped));
}

/**
 * Куда уходит фокус по Tab внутри панели. `index` — место текущего элемента среди доступных
 * (-1, если фокус вне панели), `count` — сколько их всего. Края замыкаются в кольцо.
 * Если доступных элементов нет, возвращает -1.
 */
export function nextFocusIndex(index: number, count: number, shift: boolean): number {
  if (count <= 0) return -1;
  if (shift) return index <= 0 ? count - 1 : index - 1;
  return index < 0 || index >= count - 1 ? 0 : index + 1;
}

/** Всё, что нужно знать об элементе, чтобы вернуть на него фокус. */
export interface FocusCandidate {
  isConnected: boolean;
  hidden: boolean | string;
  getClientRects(): { length: number };
}

/** Можно ли вернуть фокус на запомненный элемент: он не BODY, лежит в документе и виден. */
export function canRestoreFocus(el: FocusCandidate | null, body: unknown): boolean {
  return el !== null && el !== body && el.isConnected && !el.hidden && el.getClientRects().length > 0;
}
