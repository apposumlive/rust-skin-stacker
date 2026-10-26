// Сетка карточек. Виртуальная: в DOM только видимые ряды, поэтому тысячи записей не тормозят.
// Карточки живут, пока не сменился список: выбор, «станет …» и фокус правятся на месте, а при прокрутке
// создаются только вошедшие ряды. Так значки не мигают, а клик не теряется, если между нажатием и отпусканием
// пришло обновление (тик запуска, закрытие меню).

import { forgetToken, loadInventory, selectSkin, setFilter } from '../actions';
import { h, icon } from '../dom';
import { fmtInt, iconUrl } from '../format';
import { errorText, t, tn } from '../i18n';
import { counts, layoutOf, layoutText, pillsOf, visibleSkins, type SelectMode, type Sort } from '../model';
import type { Panel, State } from '../store';
import type { Plan, Skin, SkinAfter } from '../types';
import type { Part } from './shell';
import { CARD_HEIGHT, GAP, MIN_CARD_WIDTH, columnsFor, visibleRange, windowDiff, type Span } from './virtual';

const SKELETON_CARDS = 12;
const ROW = CARD_HEIGHT + GAP;

/** Нарисованная карточка и то, что в ней показано сейчас: DOM правится только там, где это отличается. */
interface Slot {
  el: HTMLElement;
  sub: HTMLElement;
  skin: Skin;
  selected: boolean;
  dim: boolean;
  tabbable: boolean;
  change: SkinAfter | undefined;
}

const totalText = (skin: Skin) => t('card.total', { count: fmtInt(skin.total) });

/** Новая карточка: постоянные части (название, значок, раскладка) строятся один раз, остальное — patchSlot. */
function makeSlot(skin: Skin, index: number): Slot {
  const sub = h('div', { class: 'sub' }, totalText(skin));
  const el = h(
    'div',
    { class: 'card', role: 'option', 'aria-selected': 'false', tabindex: -1, 'data-index': index, title: skin.name },
    h('div', { class: 'nm' }, skin.name),
    sub,
    h(
      'div',
      { class: 'imgbox' },
      skin.icon
        ? h('img', { src: iconUrl(skin.icon, 128), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' })
        : icon('photo-off'),
    ),
    h('div', { class: 'layout' }, ...pillsOf(layoutOf(skin)).map((p) => h('span', { class: p.stack ? 'pill st' : 'pill' }, p.text))),
  );
  return { el, sub, skin, selected: false, dim: false, tabbable: false, change: undefined };
}

/** Приводит карточку к нужному виду. `after` — раскладка «станет» из плана, пока он открыт или идёт операция. */
function patchSlot(slot: Slot, selected: boolean, tabbable: boolean, after: Map<string, SkinAfter> | null): void {
  const change = after?.get(slot.skin.key);
  const dim = after !== null && !change;
  if (slot.selected !== selected) {
    slot.selected = selected;
    slot.el.classList.toggle('sel', selected);
    slot.el.setAttribute('aria-selected', String(selected));
  }
  if (slot.dim !== dim) {
    slot.dim = dim;
    slot.el.classList.toggle('dim', dim);
  }
  if (slot.tabbable !== tabbable) {
    slot.tabbable = tabbable;
    slot.el.tabIndex = tabbable ? 0 : -1;
  }
  if (slot.change !== change) {
    slot.change = change;
    slot.sub.replaceChildren(
      change ? h('span', { class: 'becomes' }, t('after.becomes', { layout: layoutText(change.stacks, change.singles, false) })) : totalText(slot.skin),
    );
  }
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
  let lastLoading: boolean | null = null;
  let lastBanner = '';
  let bannerAction: HTMLButtonElement | null = null;
  let cols = 1;
  let focusIndex = 0;
  let frame = 0;

  // Нарисованные карточки по индексу в списке `slotsOf`; `shown` — какое окно индексов сейчас в DOM.
  const slots = new Map<number, Slot>();
  let slotsOf: Skin[] | null = null;
  let shown: Span | null = null;
  let skeletons = 0;

  // Выбранные ключи и раскладка плана пересобираются, только когда сменился сам массив или план.
  let selectedRef: string[] | null = null;
  let selectedSet = new Set<string>();
  let afterRef: Plan | null = null;
  let afterMemo: Map<string, SkinAfter> | null = null;
  const selectedKeys = (selected: string[]): Set<string> => {
    if (selected !== selectedRef) {
      selectedRef = selected;
      selectedSet = new Set(selected);
    }
    return selectedSet;
  };
  const afterOf = (panel: Panel): Map<string, SkinAfter> | null => {
    const plan = panel.kind === 'plan' || panel.kind === 'running' ? panel.plan : null;
    if (plan !== afterRef) {
      afterRef = plan;
      afterMemo = plan ? new Map(plan.after.map((a) => [a.key, a])) : null;
    }
    return afterMemo;
  };

  const order = () => list.map((s) => s.key);
  const focusCard = (index: number) => slots.get(index)?.el.focus({ preventScroll: true });
  const forgetCards = () => {
    slots.clear();
    slotsOf = null;
    shown = null;
  };

  const render = () => {
    frame = 0;
    if (!state) return;
    cols = columnsFor(scroller.clientWidth, MIN_CARD_WIDTH, GAP);
    cards.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    if (!state.inventory) {
      cards.style.transform = '';
      const count = state.loading ? SKELETON_CARDS : 0;
      spacer.style.height = `${Math.ceil(count / cols) * ROW}px`;
      // Скелет рисуется один раз: перестройка на каждое обновление сбивала бы его мерцание.
      if (count !== skeletons || slots.size) {
        forgetCards();
        skeletons = count;
        cards.replaceChildren(...Array.from({ length: count }, () => h('div', { class: 'card skeleton', 'aria-hidden': 'true' })));
      }
      return;
    }
    const range = visibleRange(list.length, cols, ROW, scroller.scrollTop, scroller.clientHeight);
    spacer.style.height = `${range.total}px`;
    cards.style.transform = `translateY(${range.padTop}px)`;
    // Карточка с фокусом должна быть нарисована, иначе Tab проскочит сетку.
    if (range.last > range.first) focusIndex = Math.min(Math.max(focusIndex, range.first), range.last - 1);
    const hadFocus = cards.contains(document.activeElement);
    // Другой список — другие карточки; тот же — сохраняем те, что остаются в окне.
    if (slotsOf !== list || skeletons) {
      cards.replaceChildren();
      forgetCards();
      skeletons = 0;
      slotsOf = list;
    }
    const diff = windowDiff(shown, range);
    for (const i of diff.remove) {
      slots.get(i)?.el.remove();
      slots.delete(i);
    }
    // С конца к началу: новая карточка встаёт перед уже стоящей следующей и не трогает остальные.
    for (let k = diff.add.length - 1; k >= 0; k--) {
      const i = diff.add[k];
      const slot = makeSlot(list[i], i);
      slots.set(i, slot);
      cards.insertBefore(slot.el, slots.get(i + 1)?.el ?? null);
    }
    shown = { first: range.first, last: range.last };
    const selected = selectedKeys(state.selected);
    const after = afterOf(state.panel);
    for (const [i, slot] of slots) patchSlot(slot, selected.has(slot.skin.key), i === focusIndex, after);
    if (hadFocus && !cards.contains(document.activeElement)) focusCard(focusIndex);
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
    if (key !== lastBanner) {
      lastBanner = key;
      banner.hidden = !key;
      bannerAction = null;
      if (s.tokenExpired) {
        bannerAction = h('button', { class: 'btn pri', type: 'button', onclick: () => void forgetToken() }, t('banner.newToken'));
        banner.replaceChildren(icon('alert-triangle'), h('span', {}, t('banner.tokenExpired')), bannerAction);
      } else if (s.error) {
        bannerAction = h('button', { class: 'btn sec', type: 'button', onclick: () => void loadInventory() }, icon('refresh'), t('banner.retry'));
        banner.replaceChildren(icon('alert-triangle'), h('span', {}, errorText(s.error)), bannerAction);
      }
    }
    // Пока идёт запуск, «Повторить» слало бы лишние чтения, а «Новый токен» оборвал бы операцию.
    if (bannerAction) bannerAction.disabled = s.panel.kind === 'running';
  };

  return {
    update(s) {
      state = s;
      const inventoryChanged = s.inventory !== lastInventory;
      if (inventoryChanged) meta.textContent = s.inventory ? tn('grid.meta', counts(s.inventory).stacks) : '';
      if (inventoryChanged || s.filter !== lastFilter) {
        if (lastFilter && s.filter !== lastFilter) scroller.scrollTop = 0;
        list = s.inventory ? visibleSkins(s.inventory, s.filter) : [];
        lastInventory = s.inventory;
        lastFilter = s.filter;
        sort.value = s.filter.sort;
        empty.hidden = !(s.inventory && list.length === 0);
        empty.textContent = s.inventory?.skins.length === 0 ? t('grid.empty') : t('grid.nothingFound');
      }
      paintBanner(s);
      if (s.loading !== lastLoading) {
        lastLoading = s.loading;
        cards.setAttribute('aria-busy', String(s.loading));
      }
      render();
    },
    destroy() {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
