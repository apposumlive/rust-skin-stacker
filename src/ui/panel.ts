// Правая панель. Перерисовывается только при смене того, что в ней показано:
// иначе ввод в поиске сбрасывал бы ползунок «Отделить по одному». Ход операции правится на месте (panel-diff.ts).

import { h } from '../dom';
import type { State } from '../store';
import type { Skin } from '../types';
import { entering, focusPlace, panelStep, showsLoad, shownOf, swallowsKey, takesFocus, type Shown } from './panel-diff';
import { loadingView, patchLoading } from './panel-load';
import { patchRunning, planView, resultView, runningView } from './panel-run';
import { hintView, itemView, multiView } from './panel-select';
import type { Part } from './shell';

function view(state: State, tick: (fn: () => void) => void): HTMLElement {
  // Чтение без запуска перекрывает всё: и когда инвентаря ещё нет, и когда он есть, но выбор и план под ним не видны.
  if (showsLoad(state)) return loadingView(state, tick);
  const inventory = state.inventory;
  if (!inventory) return h('div', { class: 'panel' });
  const panel = state.panel;
  switch (panel.kind) {
    case 'plan':
      return planView(panel.plan, panel.changed, state);
    case 'running':
      return runningView(panel, state, tick);
    case 'result':
      return resultView(panel);
    case 'selection': {
      const byKey = new Map(inventory.skins.map((skin) => [skin.key, skin]));
      const skins = state.selected.map((key) => byKey.get(key)).filter((skin): skin is Skin => skin !== undefined);
      if (skins.length === 1) return itemView(skins[0], state);
      if (skins.length > 1) return multiView(skins);
      return hintView(inventory);
    }
  }
}

/** Правит текущий вид на месте; `false` — это не тот вид, который нужен состоянию, его надо собрать заново. */
function patched(current: Element | null, state: State, tick: (fn: () => void) => void): boolean {
  if (!(current instanceof HTMLElement)) return false;
  if (showsLoad(state)) return patchLoading(current, state, tick);
  return state.panel.kind === 'running' && patchRunning(current, state.panel, state, tick);
}

export function createPanel(el: HTMLElement): Part {
  let shown: Shown | null = null;
  let timer = 0;
  const stopTimer = () => {
    window.clearInterval(timer);
    timer = 0;
  };
  const tick = (fn: () => void) => {
    stopTimer();
    timer = window.setInterval(fn, 1000);
  };
  // Перехват до кнопки: автоповтор Enter после смены вида пришёл бы на новый главный элемент и нажал бы его.
  const onKey = (e: KeyboardEvent) => {
    if (swallowsKey(e.key, e.repeat)) e.preventDefault();
  };
  el.addEventListener('keydown', onKey, true);
  return {
    update(state) {
      const next = shownOf(state);
      const step = panelStep(shown, next);
      const enter = entering(shown, next);
      const prev = shown;
      shown = next;
      if (step === 'keep') return;
      stopTimer();
      // Ход и загрузка правятся на месте: «Остановить» остаётся тем же узлом и не теряет фокус и клик.
      if (step === 'patch' && patched(el.firstElementChild, state, tick)) return;
      const place = focusPlace(document.activeElement, el, document.body);
      const fresh = view(state, tick);
      if (enter) fresh.classList.add('enter');
      el.replaceChildren(fresh);
      // Главный элемент нового вида: «Запустить» в плане, заголовок в ходе и остальных. «Остановить» — только по Tab.
      // Исключение — уход с «Хода» или «Загрузки»: человек мог нажать «Остановить» Enter'ом или пробелом, а операция
      // оборвана, и план вернулся. Следующее нажатие не должно попасть в «Запустить» и снова запустить остановленное,
      // поэтому фокус идёт на заголовок (у плана он без `data-main`; у остальных видов заголовок и есть главный элемент).
      if (takesFocus(place) && el.isConnected) {
        const afterStop = prev !== null && (prev.panel.kind === 'running' || showsLoad(prev));
        const target = (afterStop && fresh.querySelector<HTMLElement>('[tabindex]')) || fresh.querySelector<HTMLElement>('[data-main]');
        target?.focus({ preventScroll: true });
      }
    },
    destroy() {
      stopTimer();
      el.removeEventListener('keydown', onKey, true);
    },
  };
}
