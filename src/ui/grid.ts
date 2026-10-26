// Сетка карточек. Виртуальная: в DOM только видимые ряды, поэтому тысячи записей не тормозят.

import { forgetToken, loadInventory, selectSkin, setFilter } from '../actions';
import { h, icon } from '../dom';
import { fmtInt, iconUrl } from '../format';
import { errorText, t, tn } from '../i18n';
import { counts, layoutOf, layoutText, pillsOf, visibleSkins, type SelectMode, type Sort } from '../model';
import type { Panel, State } from '../store';
import type { Skin, SkinAfter } from '../types';
import type { Part } from './shell';
import { CARD_HEIGHT, GAP, MIN_CARD_WIDTH, columnsFor, visibleRange } from './virtual';

const SKELETON_CARDS = 12;
const ROW = CARD_HEIGHT + GAP;

/** Раскладка «станет» для карточек, пока открыт план или идёт операция. */
function afterMap(panel: Panel): Map<string, SkinAfter> | null {
  if (panel.kind !== 'plan' && panel.kind !== 'running') return null;
  return new Map(panel.plan.after.map((a) => [a.key, a]));
}

function card(skin: Skin, index: number, selected: boolean, tabbable: boolean, after: Map<string, SkinAfter> | null): HTMLElement {
  const change = after?.get(skin.key);
  const sub = change
    ? h('span', { class: 'becomes' }, t('after.becomes', { layout: layoutText(change.stacks, change.singles, false) }))
    : t('card.total', { count: fmtInt(skin.total) });
  return h(
    'div',
    {
      class: `card${selected ? ' sel' : ''}${after && !change ? ' dim' : ''}`,
      role: 'option',
      'aria-selected': String(selected),
      tabindex: tabbable ? 0 : -1,
      'data-index': index,
      title: skin.name,
    },
    h('div', { class: 'nm' }, skin.name),
    h('div', { class: 'sub' }, sub),
    h(
      'div',
      { class: 'imgbox' },
      skin.icon
        ? h('img', { src: iconUrl(skin.icon, 128), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' })
        : icon('photo-off'),
    ),
    h('div', { class: 'layout' }, ...pillsOf(layoutOf(skin)).map((p) => h('span', { class: p.stack ? 'pill st' : 'pill' }, p.text))),
  );
}

export function createGrid(el: HTMLElement): Part {
  const banner = h('div', { class: 'banner', role: 'alert', hidden: true });
  const meta = h('span', { class: 'meta' });
  const sort = h(
    'select',
    { class: 'sort', 'aria-label': t('grid.sort') },
    h('option', { value: 'amount' }, t('sort.amount')),
    h('option', { value: 'name' }, t('sort.name')),
  );
  sort.addEventListener('change', () => setFilter({ sort: sort.value as Sort }));
  const cards = h('div', { class: 'grid', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': t('grid.title') });
  const spacer = h('div', { class: 'spacer' }, cards);
  const empty = h('p', { class: 'empty', hidden: true });
  const scroller = h('div', { class: 'scroller' }, spacer, empty);
  el.append(
    banner,
    h('div', { class: 'bar' }, h('h1', {}, t('grid.title')), meta, h('span', { class: 'sort-wrap' }, icon('arrows-sort'), sort)),
    scroller,
  );

  let state: State | null = null;
  let list: Skin[] = [];
  let lastInventory: State['inventory'] = null;
  let lastFilter: State['filter'] | null = null;
  let lastBanner = '';
  let cols = 1;
  let focusIndex = 0;
  let frame = 0;

  const order = () => list.map((s) => s.key);
  const focusCard = (index: number) => cards.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus({ preventScroll: true });

  const render = () => {
    frame = 0;
    if (!state) return;
    cols = columnsFor(scroller.clientWidth, MIN_CARD_WIDTH, GAP);
    cards.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    if (!state.inventory) {
      cards.style.transform = '';
      const skeleton = state.loading ? SKELETON_CARDS : 0;
      spacer.style.height = `${Math.ceil(skeleton / cols) * ROW}px`;
      cards.replaceChildren(...Array.from({ length: skeleton }, () => h('div', { class: 'card skeleton', 'aria-hidden': 'true' })));
      return;
    }
    const range = visibleRange(list.length, cols, ROW, scroller.scrollTop, scroller.clientHeight);
    spacer.style.height = `${range.total}px`;
    cards.style.transform = `translateY(${range.padTop}px)`;
    // Карточка с фокусом должна быть нарисована, иначе Tab проскочит сетку.
    focusIndex = Math.min(Math.max(focusIndex, range.first), Math.max(range.first, range.last - 1));
    const selected = new Set(state.selected);
    const after = afterMap(state.panel);
    const hadFocus = cards.contains(document.activeElement);
    const nodes: HTMLElement[] = [];
    for (let i = range.first; i < range.last; i++) {
      nodes.push(card(list[i], i, selected.has(list[i].key), i === focusIndex, after));
    }
    cards.replaceChildren(...nodes);
    if (hadFocus) focusCard(focusIndex);
  };

  const moveFocus = (index: number) => {
    if (!list.length) return;
    focusIndex = Math.min(list.length - 1, Math.max(0, index));
    const top = Math.floor(focusIndex / cols) * ROW;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + CARD_HEIGHT > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = top + CARD_HEIGHT - scroller.clientHeight;
    }
    render();
    focusCard(focusIndex);
  };

  const pick = (index: number, mode: SelectMode) => {
    const skin = list[index];
    if (!skin) return;
    focusIndex = index;
    selectSkin(skin.key, mode, order());
  };

  cards.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('.card[data-index]');
    if (!target) return;
    pick(Number(target.dataset.index), e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single');
  });
  cards.addEventListener('keydown', (e) => {
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: cols,
      ArrowUp: -cols,
      PageDown: cols * 3,
      PageUp: -cols * 3,
      Home: -list.length,
      End: list.length,
    };
    if (e.key in moves) {
      e.preventDefault();
      moveFocus(focusIndex + moves[e.key]);
    } else if (e.key === ' ') {
      e.preventDefault();
      pick(focusIndex, e.shiftKey ? 'range' : 'toggle');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(focusIndex, 'single');
    }
  });
  cards.addEventListener('focusin', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('.card[data-index]');
    if (target) focusIndex = Number(target.dataset.index);
  });
  scroller.addEventListener('scroll', () => {
    if (!frame) frame = requestAnimationFrame(render);
  });
  const observer = new ResizeObserver(() => render());
  observer.observe(scroller);

  const paintBanner = (s: State) => {
    const key = s.tokenExpired ? 'token' : s.error ? `error:${s.error.code}:${s.error.status}` : '';
    if (key === lastBanner) return;
    lastBanner = key;
    banner.hidden = !key;
    if (s.tokenExpired) {
      banner.replaceChildren(
        icon('alert-triangle'),
        h('span', {}, t('banner.tokenExpired')),
        h('button', { class: 'btn pri', type: 'button', onclick: () => void forgetToken() }, t('banner.newToken')),
      );
    } else if (s.error) {
      banner.replaceChildren(
        icon('alert-triangle'),
        h('span', {}, errorText(s.error)),
        h('button', { class: 'btn sec', type: 'button', onclick: () => void loadInventory() }, icon('refresh'), t('banner.retry')),
      );
    }
  };

  return {
    update(s) {
      state = s;
      if (s.inventory !== lastInventory || s.filter !== lastFilter) {
        if (lastFilter && s.filter !== lastFilter) scroller.scrollTop = 0;
        list = s.inventory ? visibleSkins(s.inventory, s.filter) : [];
        lastInventory = s.inventory;
        lastFilter = s.filter;
      }
      sort.value = s.filter.sort;
      meta.textContent = s.inventory ? tn('grid.meta', counts(s.inventory).stacks) : '';
      paintBanner(s);
      empty.hidden = !(s.inventory && list.length === 0);
      empty.textContent = s.inventory?.skins.length === 0 ? t('grid.empty') : t('grid.nothingFound');
      cards.setAttribute('aria-busy', String(s.loading));
      render();
    },
    destroy() {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
