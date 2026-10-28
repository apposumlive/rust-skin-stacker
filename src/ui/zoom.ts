// Масштаб окна: выбранный (настройки и клавиши Ctrl+= / Ctrl+− / Ctrl+0) и применённый. Применённый бывает меньше
// выбранного: в маленьком окне масштаб уменьшается сам, чтобы всё поместилось. Работает на любом экране и во время
// операции: это только вид.

import { setUiScale } from '../actions';
import { api } from '../api';
import { getState, subscribe } from '../store';
import { effectiveScale, stepScale, zoomKey } from '../zoom';

/** Пересчёт после изменения размера окна: пока окно тянут мышью, событий много. */
export const RESIZE_DELAY = 150;

/** Применяет масштаб из настроек и следит за клавишами, размером окна и сохранёнными настройками. Возвращает «выключить». */
export function startZoom(): () => void {
  let chosen = getState().settings.uiScale;
  let saved = chosen;
  // Применённый масштаб; null — ещё не применяли: зум WebView считаем 100 %, но при старте ставим его всегда.
  let applied: number | null = null;
  let timer = 0;

  const apply = () => {
    const current = applied ?? 100;
    // Размер окна в логических пикселях: CSS-пиксели при текущем зуме. Лишних прав на чтение размера окна не нужно.
    const next = effectiveScale(chosen, (window.innerWidth * current) / 100, (window.innerHeight * current) / 100);
    if (next === applied) return;
    const was = applied;
    applied = next;
    api.setZoom(next / 100).catch(() => {
      // Зум не сменился: считаем по прежнему, следующая попытка — по клавише или при изменении размера окна.
      if (applied === next) applied = was;
    });
  };

  const onKey = (e: KeyboardEvent) => {
    const dir = zoomKey(e);
    if (dir === null) return;
    e.preventDefault();
    const next = dir === 0 ? 100 : stepScale(chosen, dir);
    if (next === chosen) return;
    chosen = next;
    apply();
    void setUiScale(next);
  };

  const onResize = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(apply, RESIZE_DELAY);
  };

  // Масштаб сохранили (в панели настроек или клавишами) — он и выбран. Не сохранился — выбранный остаётся до перезапуска.
  const unsubscribe = subscribe((state) => {
    if (state.settings.uiScale === saved) return;
    saved = state.settings.uiScale;
    chosen = saved;
    apply();
  });

  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  apply();

  return () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    window.clearTimeout(timer);
    unsubscribe();
  };
}
