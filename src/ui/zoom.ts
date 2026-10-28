// Масштаб окна: выбранный в настройках («Авто» или 100–150 %, клавиши Ctrl+= / Ctrl+− / Ctrl+0) и применённый.
// «Авто» берёт масштаб по высоте экрана. Применённый бывает меньше выбранного: в маленьком окне масштаб уменьшается
// сам, чтобы всё поместилось. Размер окна и экрана даёт ядро в логических пикселях: от зума WebView он не зависит.
// Работает на любом экране и во время операции: это только вид.

import { clearScaleError, setUiScale, showScaleError } from '../actions';
import { api, type WindowMetrics } from '../api';
import { getState, subscribe } from '../store';
import type { UiError } from '../types';
import { AUTO, autoScale, chosenScale, effectiveScale, stepScale, zoomKey, type UiScale } from '../zoom';

/** Пересчёт после изменения окна: пока окно тянут мышью, событий много. */
export const RESIZE_DELAY = 150;

// Высота экрана из последнего замера (0 — ещё не знаем): панель настроек пишет, сколько сейчас даёт «Авто».
let monitorHeight = 0;

/** Сколько «Авто» даёт на этом экране сейчас. */
export function currentAutoScale(): UiScale {
  return autoScale(monitorHeight);
}

/** Применяет масштаб из настроек и следит за клавишами, окном и сохранёнными настройками. Возвращает «выключить». */
export function startZoom(): () => void {
  // Выбранный в настройках: AUTO или значение списка.
  let chosen = getState().settings.uiScale;
  let saved = chosen;
  // Размер окна и экрана; null — ядро ещё не ответило, масштаб не применяем.
  let metrics: WindowMetrics | null = null;
  // Применённый масштаб; null — ещё не применяли: при старте ставим его всегда, даже 100 %.
  let applied: UiScale | null = null;
  // Масштаб, который ядро не применило: сам его снова не просим, только после клавиши или сохранения настроек.
  let refused: UiScale | null = null;
  // Зум меняется: следующая смена — только после ответа ядра.
  let zooming = false;
  let reading = 0;
  let timer = 0;
  let stopped = false;
  // Ошибку размера окна или событий окна уже показали.
  let reported = false;
  // Показанные ошибки: отказ ядра сменить зум и «размер окна не прочитался». Каждую убирает только её же успех.
  let refusal: UiError | null = null;
  let unreadable: UiError | null = null;
  let unlisten: (() => void) | null = null;

  const apply = () => {
    if (stopped || zooming || !metrics) return;
    const next = effectiveScale(chosenScale(chosen, metrics.monitorHeight), metrics.width, metrics.height);
    if (next === applied || next === refused) return;
    void zoomTo(next);
  };

  const zoomTo = async (next: UiScale) => {
    zooming = true;
    try {
      await api.setZoom(next / 100);
      applied = next;
      refused = null;
      // Зум сменился: прежний отказ больше не верен.
      if (!stopped) clearScaleError(refusal);
      refusal = null;
    } catch {
      // Зум не сменился: остаётся прежний. Журнал — в ядре, окну записать в него нечего: показываем ошибку.
      refused = next;
      if (!stopped) {
        refusal = { code: 'zoomFailed', status: null };
        showScaleError(refusal);
      }
    } finally {
      zooming = false;
    }
    // Пока зум менялся, могли нажать клавишу или изменить окно: применяем последний выбор.
    apply();
  };

  // Размер окна не прочитался или события окна не слушаются: говорим один раз, иначе масштаб молча не работает.
  const failed = (): UiError | null => {
    if (stopped || reported) return null;
    reported = true;
    const error: UiError = { code: 'zoomFailed', status: null };
    showScaleError(error);
    return error;
  };

  // Ответ на устаревший замер отбрасывается. Размер не прочитался — остаётся прежний; нет и прежнего — ошибка.
  const measure = async () => {
    const mine = ++reading;
    let next: WindowMetrics;
    try {
      next = await api.windowMetrics();
    } catch {
      if (mine === reading && !metrics) unreadable = failed() ?? unreadable;
      return;
    }
    if (mine !== reading || stopped) return;
    // Свёрнутое окно (Windows) отдаёт 0×0: такой размер не берём, остаётся прежний.
    if (next.width <= 0 || next.height <= 0) return;
    // Размер наконец прочитался: ошибка о нём больше не верна.
    clearScaleError(unreadable);
    unreadable = null;
    metrics = next;
    monitorHeight = next.monitorHeight;
    apply();
  };

  const onWindowChange = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void measure(), RESIZE_DELAY);
  };

  const listen = async () => {
    try {
      const off = await api.onWindowChange(onWindowChange);
      if (stopped) off();
      else unlisten = off;
    } catch {
      // Без событий окна масштаб пересчитывается только по клавишам и настройкам.
      failed();
    }
  };

  const onKey = (e: KeyboardEvent) => {
    const dir = zoomKey(e);
    if (dir === null) return;
    e.preventDefault();
    // Шаг — от выбранного, у «Авто» — от того, что оно даёт сейчас. Ctrl+0 — снова «Авто».
    const current = chosenScale(chosen, metrics?.monitorHeight ?? 0);
    const next = dir === 0 ? AUTO : stepScale(current, dir);
    // На краю списка шаг ничего не меняет: «Авто» остаётся «Авто», а не становится тем же масштабом без «Авто».
    if (next === chosen || (dir !== 0 && next === current)) return;
    chosen = next;
    refused = null;
    apply();
    void setUiScale(next);
  };

  // Масштаб сохранили (в панели настроек или клавишами) — он и выбран. Не сохранился — выбранный остаётся до перезапуска.
  const unsubscribe = subscribe((state) => {
    if (state.settings.uiScale === saved) return;
    saved = state.settings.uiScale;
    chosen = saved;
    refused = null;
    apply();
  });

  window.addEventListener('keydown', onKey, true);
  void listen();
  void measure();

  return () => {
    stopped = true;
    window.removeEventListener('keydown', onKey, true);
    window.clearTimeout(timer);
    unlisten?.();
    unlisten = null;
    unsubscribe();
  };
}
