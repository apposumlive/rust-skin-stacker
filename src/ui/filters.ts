// Левая колонка: поиск, «Показать», «Тип» и итоги инвентаря.

import { setFilter } from '../actions';
import { h, icon } from '../dom';
import { fmtInt } from '../format';
import { t } from '../i18n';
import { categoriesOf, counts, totals, type Show } from '../model';
import { getState, type State } from '../store';
import type { Part } from './shell';

const SHOWS: Show[] = ['all', 'stacks', 'dupes'];

function toggleCategory(id: string): void {
  const current = getState().filter.categories;
  setFilter({ categories: current.includes(id) ? current.filter((c) => c !== id) : [...current, id] });
}

function statRow(label: string, value: string): HTMLElement {
  return h('div', {}, h('dt', {}, label), h('dd', { class: 'num' }, value));
}

export function createFilters(el: HTMLElement): Part {
  const search = h('input', {
    class: 'search-input',
    type: 'search',
    placeholder: t('filters.search'),
    'aria-label': t('filters.search'),
    autocomplete: 'off',
    spellcheck: 'false',
  });
  search.addEventListener('input', () => setFilter({ search: search.value }));
  const shows = SHOWS.map((value) => {
    const count = h('span', { class: 'c num' });
    const button = h(
      'button',
      {
        class: 'opt',
        type: 'button',
        role: 'radio',
        title: value === 'dupes' ? t('filters.dupesHint') : undefined,
        onclick: () => setFilter({ show: value }),
      },
      h('span', { class: 'box round' }, icon('check')),
      t(`filters.${value}`),
      count,
    );
    return { value, button, count };
  });
  const types = h('div', { role: 'group', 'aria-label': t('filters.type') });
  const stats = h('dl', { class: 'stats' });
  el.append(
    h('label', { class: 'search' }, icon('search'), search),
    h('div', { role: 'radiogroup', 'aria-label': t('filters.show') }, h('div', { class: 'fh' }, t('filters.show')), ...shows.map((s) => s.button)),
    h('div', {}, h('div', { class: 'fh' }, t('filters.type')), types),
    stats,
  );

  let lastInventory: State['inventory'] = null;
  let lastFilter: State['filter'] | null = null;
  return {
    update(s) {
      if (s.inventory === lastInventory && s.filter === lastFilter) return;
      lastInventory = s.inventory;
      lastFilter = s.filter;
      if (document.activeElement !== search && search.value !== s.filter.search) search.value = s.filter.search;

      const inv = s.inventory;
      const c = inv ? counts(inv) : null;
      for (const o of shows) {
        const on = s.filter.show === o.value;
        o.button.classList.toggle('on', on);
        o.button.setAttribute('aria-checked', String(on));
        o.count.textContent = c ? fmtInt(c[o.value]) : '';
      }

      const list = inv ? categoriesOf(inv) : [];
      types.replaceChildren(
        ...(list.length
          ? list.map((category) => {
              const on = s.filter.categories.includes(category.id);
              return h(
                'button',
                { class: on ? 'opt on' : 'opt', type: 'button', role: 'checkbox', 'aria-checked': String(on), onclick: () => toggleCategory(category.id) },
                h('span', { class: 'box' }, icon('check')),
                category.label,
              );
            })
          : [h('p', { class: 'muted small' }, t('filters.noTypes'))]),
      );

      if (!inv) {
        stats.replaceChildren();
        return;
      }
      const sum = totals(inv);
      const rows = [
        statRow(t('stats.total'), t('card.total', { count: fmtInt(sum.items) })),
        statRow(t('stats.records'), fmtInt(sum.records)),
        statRow(t('stats.stacks'), fmtInt(sum.stacks)),
      ];
      if (sum.unreadable) rows.push(statRow(t('stats.unreadable'), fmtInt(sum.unreadable)));
      stats.replaceChildren(...rows);
    },
  };
}
