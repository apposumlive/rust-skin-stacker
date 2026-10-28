// Правила масштаба окна. Масштаб — зум всего WebView, а не правка CSS: текст, карточки и отступы растут вместе,
// а виртуальная сетка по-прежнему считает в CSS-пикселях. Применяет масштаб ui/zoom.ts.

import type { KeyLike } from './keys';

/** Как UI_SCALES в src-tauri/src/settings.rs: масштаб не из списка ядро сбрасывает на 100. */
export const UI_SCALES = [100, 110, 125, 150] as const;
export type UiScale = (typeof UI_SCALES)[number];

// Минимальный размер окна из tauri.conf.json: с масштабом окно в CSS-пикселях не должно стать меньше.
export const MIN_WIDTH = 1024;
export const MIN_HEIGHT = 640;

/** Ближайшее значение списка; при равном расстоянии — меньшее. */
function nearestIndex(value: number): number {
  let best = 0;
  UI_SCALES.forEach((scale, i) => {
    if (Math.abs(scale - value) < Math.abs(UI_SCALES[best] - value)) best = i;
  });
  return best;
}

/** Соседнее значение списка вверх или вниз; на краях остаётся крайним. Значение не из списка — сначала к ближайшему. */
export function stepScale(current: number, dir: 1 | -1): UiScale {
  const i = Math.min(UI_SCALES.length - 1, Math.max(0, nearestIndex(current) + dir));
  return UI_SCALES[i];
}

/**
 * Масштаб, который можно применить в окне этого размера (логические пиксели): наибольший из списка, не больше
 * выбранного, при котором окно в CSS-пикселях не меньше минимального. Не меньше 100.
 */
export function effectiveScale(chosen: number, logicalWidth: number, logicalHeight: number): UiScale {
  let best: UiScale = 100;
  for (const scale of UI_SCALES) {
    if (scale <= chosen && (logicalWidth * 100) / scale >= MIN_WIDTH && (logicalHeight * 100) / scale >= MIN_HEIGHT) best = scale;
  }
  return best;
}

/**
 * Клавиши масштаба: 1 — крупнее, −1 — мельче, 0 — сброс к 100, null — не масштаб. По физической клавише (`code`),
 * чтобы работало в любой раскладке. Shift не важен: Ctrl+Shift+= — это «Ctrl++».
 */
export function zoomKey(e: KeyLike & { shiftKey?: boolean }): 1 | -1 | 0 | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.code === 'Equal' || e.code === 'NumpadAdd') return 1;
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') return -1;
  if (e.code === 'Digit0' || e.code === 'Numpad0') return 0;
  return null;
}
