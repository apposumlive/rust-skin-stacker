// Каркас главного окна: верхняя панель и три колонки. Каждая часть сама решает, что перерисовать.

import { loadInventory } from '../actions';
import { h } from '../dom';
import { getState, subscribe, type State } from '../store';
import { createFilters } from './filters';
import { createGrid } from './grid';
import type { Screen } from './login';
import { createPanel } from './panel';
import { createTopbar } from './topbar';

export interface Part {
  update(state: State): void;
  destroy?(): void;
}

export function mountMain(): Screen {
  const top = h('header', { class: 'top' });
  const filters = h('aside', { class: 'filters' });
  const content = h('section', { class: 'content' });
  const side = h('aside', { class: 'side' });
  const el = h('div', { class: 'app' }, top, h('div', { class: 'wrap' }, filters, content, side));
  const parts: Part[] = [createTopbar(top), createFilters(filters), createGrid(content), createPanel(side)];
  const update = (state: State) => {
    for (const part of parts) part.update(state);
  };
  const unsubscribe = subscribe(update);
  update(getState());
  if (!getState().inventory && !getState().loading) void loadInventory();
  return {
    el,
    destroy: () => {
      unsubscribe();
      for (const part of parts) part.destroy?.();
    },
  };
}
