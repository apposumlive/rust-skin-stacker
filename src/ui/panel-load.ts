// Правая панель, пока инвентарь читается без запуска: заголовок, прочитанное, ожидание по 429 и «Остановить».

import { stopLoad } from '../actions';
import { h, icon } from '../dom';
import { fmtInt } from '../format';
import { t } from '../i18n';
import type { State } from '../store';
import { paintWait } from './panel-run';
import { mainHeading, panelView } from './panel-select';

/** Части вида «Загрузка», которые меняются по ходу чтения. Сами узлы живут всё время чтения. */
interface LoadingParts {
  bar: HTMLElement;
  fill: HTMLElement;
  progress: HTMLElement;
  wait: HTMLElement;
  stop: HTMLButtonElement;
  stopLabel: HTMLElement;
}

const loadingParts = new WeakMap<HTMLElement, LoadingParts>();

/** «Записей прочитано» и полоса. До первой страницы скрыто всё; полоса видна, только когда Steam назвал, сколько записей всего. */
function paintProgress(parts: LoadingParts, progress: State['loadProgress']): void {
  const total = progress?.total ?? null;
  parts.progress.hidden = !progress;
  parts.progress.textContent = !progress
    ? ''
    : total === null
      ? t('load.progressCount', { read: fmtInt(progress.read) })
      : t('load.progress', { read: fmtInt(progress.read), total: fmtInt(total) });
  parts.bar.hidden = !progress || total === null || total <= 0;
  if (!progress || total === null || total <= 0) return;
  parts.fill.style.width = `${Math.min(100, Math.round((progress.read / total) * 100))}%`;
  parts.bar.setAttribute('aria-valuemax', String(total));
  parts.bar.setAttribute('aria-valuenow', String(Math.min(progress.read, total)));
}

function paintLoading(parts: LoadingParts, state: State, tick: (fn: () => void) => void): void {
  paintProgress(parts, state.loadProgress);
  parts.stop.disabled = state.loadStopping;
  parts.stopLabel.textContent = t(state.loadStopping ? 'load.stopping' : 'run.stop');
  paintWait(parts.wait, state.loadWaitUntil, tick);
}

export function loadingView(state: State, tick: (fn: () => void) => void): HTMLElement {
  const heading = t('grid.loading');
  const fill = h('div', { class: 'fill' });
  // Полоса той же разметки, что в «Ходе»; чтец экрана называет её так же, как заголовок.
  const bar = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-label': heading }, fill);
  const progress = h('p', { class: 'num' });
  const wait = h('p', { class: 'wait num', role: 'status' });
  const stopLabel = h('span', {});
  // Фокус на заголовок, как в «Ходе»: случайный второй Enter или пробел не оборвал бы чтение. До «Остановить» доходят по Tab.
  const stop = h('button', { class: 'btn danger wide', type: 'button', onclick: stopLoad }, icon('player-stop'), stopLabel);
  const el = panelView('load-view', [mainHeading('plan-h', heading), bar, progress, wait], [stop]);
  const parts: LoadingParts = { bar, fill, progress, wait, stop, stopLabel };
  loadingParts.set(el, parts);
  paintLoading(parts, state, tick);
  return el;
}

/**
 * Обновляет вид «Загрузка» на месте: узлы, в том числе «Остановить», остаются теми же, поэтому фокус и клик не теряются.
 * `false` — это не вид «Загрузка», его надо собрать заново.
 */
export function patchLoading(el: HTMLElement, state: State, tick: (fn: () => void) => void): boolean {
  const parts = loadingParts.get(el);
  if (!parts) return false;
  paintLoading(parts, state, tick);
  return true;
}
