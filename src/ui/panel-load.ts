// Правая панель, пока инвентарь читается без запуска: заголовок, ожидание по 429 и «Остановить».

import { stopLoad } from '../actions';
import { h, icon } from '../dom';
import { t } from '../i18n';
import type { State } from '../store';
import { paintWait } from './panel-run';
import { mainHeading, panelView } from './panel-select';

/** Части вида «Загрузка», которые меняются по ходу чтения. Сами узлы живут всё время чтения. */
interface LoadingParts {
  wait: HTMLElement;
  stop: HTMLButtonElement;
  stopLabel: HTMLElement;
}

const loadingParts = new WeakMap<HTMLElement, LoadingParts>();

function paintLoading(parts: LoadingParts, state: State, tick: (fn: () => void) => void): void {
  parts.stop.disabled = state.loadStopping;
  parts.stopLabel.textContent = t(state.loadStopping ? 'load.stopping' : 'run.stop');
  paintWait(parts.wait, state.loadWaitUntil, tick);
}

export function loadingView(state: State, tick: (fn: () => void) => void): HTMLElement {
  const wait = h('p', { class: 'wait num', role: 'status' });
  const stopLabel = h('span', {});
  // Фокус на заголовок, как в «Ходе»: случайный второй Enter или пробел не оборвал бы чтение. До «Остановить» доходят по Tab.
  const stop = h('button', { class: 'btn danger wide', type: 'button', onclick: stopLoad }, icon('player-stop'), stopLabel);
  const el = panelView('load-view', [mainHeading('plan-h', t('grid.loading')), wait], [stop]);
  const parts: LoadingParts = { wait, stop, stopLabel };
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
