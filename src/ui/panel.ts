// Правая панель. Перерисовывается только при смене того, что в ней показано:
// иначе ввод в поиске сбрасывал бы ползунок «Отделить по одному».

import { h } from '../dom';
import type { Panel, State } from '../store';
import type { Inventory, Skin } from '../types';
import { planView, resultView, runningView } from './panel-run';
import { hintView, itemView, multiView } from './panel-select';
import type { Part } from './shell';

interface Shown {
  panel: Panel;
  selected: string[];
  inventory: Inventory | null;
  delay: number;
  loading: boolean;
}

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
      const next: Shown = {
        panel: state.panel,
        selected: state.selected,
        inventory: state.inventory,
        delay: state.settings.delayMs,
        loading: state.loading,
      };
      if (shown && (Object.keys(next) as (keyof Shown)[]).every((k) => shown![k] === next[k])) return;
      shown = next;
      stopTimer();
      el.replaceChildren(view(state, tick));
    },
    destroy: stopTimer,
  };
}
