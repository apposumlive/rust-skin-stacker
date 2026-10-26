// Правая панель. Перерисовывается только при смене того, что в ней показано:
// иначе ввод в поиске сбрасывал бы ползунок «Отделить по одному». Ход операции правится на месте (panel-diff.ts).

import { h } from '../dom';
import type { State } from '../store';
import type { Skin } from '../types';
import { entering, panelStep, shownOf, type Shown } from './panel-diff';
import { patchRunning, planView, resultView, runningView } from './panel-run';
import { hintView, itemView, multiView } from './panel-select';
import type { Part } from './shell';

function view(state: State, tick: (fn: () => void) => void): HTMLElement {
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
  return {
    update(state) {
      const next = shownOf(state);
      const step = panelStep(shown, next);
      const enter = entering(shown, next);
      shown = next;
      if (step === 'keep') return;
      stopTimer();
      // Ход правится на месте: «Остановить» остаётся тем же узлом и не теряет фокус и клик.
      const current = el.firstElementChild;
      if (step === 'patch' && state.panel.kind === 'running' && current instanceof HTMLElement && patchRunning(current, state.panel, state, tick)) return;
      const fresh = view(state, tick);
      if (enter) fresh.classList.add('enter');
      el.replaceChildren(fresh);
    },
    destroy: stopTimer,
  };
}
