// Левая колонка: поиск, «Показать», «Тип» и итоги инвентаря.

import { setFilter } from '../actions';
import { h, icon } from '../dom';
import { fmtInt } from '../format';
import { t } from '../i18n';
import { categoriesOf, counts, statLines, totals, type Show } from '../model';
import { getState, type State } from '../store';
import type { Category } from '../types';
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
  // Флажок под вариантами «Показать»: вид как у флажков «Тип», число справа как у вариантов. Виден, только когда есть что скрывать.
  const untradableCount = h('span', { class: 'c num' });
  const untradable = h(
    'button',
    {
      class: 'opt long',
      type: 'button',
      role: 'checkbox',
      'aria-checked': 'false',
      title: t('filters.untradableHint'),
      hidden: true,
      onclick: () => setFilter({ untradable: !getState().filter.untradable }),
    },
    h('span', { class: 'box' }, icon('check')),
    h('span', { class: 'lbl' }, t('filters.untradable')),
    untradableCount,
  );
  const types = h('div', { role: 'group', 'aria-label': t('filters.type') });
  const stats = h('dl', { class: 'stats' });
  el.append(
    h('label', { class: 'search' }, icon('search'), search),
    h(
      'div',
      {},
      h('div', { role: 'radiogroup', 'aria-label': t('filters.show') }, h('div', { class: 'fh' }, t('filters.show')), ...shows.map((s) => s.button)),
      untradable,
    ),
    h('div', {}, h('div', { class: 'fh' }, t('filters.type')), types),
    stats,
  );

  // Кнопки «Тип» по id категории. Список перестраивается, только когда сменился набор категорий:
  // иначе нажатие пробела на флажке удаляло бы его, и фокус падал бы на <body>.
  const typeButtons = new Map<string, HTMLElement>();
  let typesKey: string | null = null;
  const paintTypes = (list: Category[]) => {
    const key = list.map((category) => `${category.id}\n${category.label}`).join('\n\n');
    if (key === typesKey) return;
    typesKey = key;
    typeButtons.clear();
    types.replaceChildren(
      ...(list.length
        ? list.map((category) => {
            const button = h(
              'button',
              { class: 'opt', type: 'button', role: 'checkbox', 'aria-checked': 'false', onclick: () => toggleCategory(category.id) },
              h('span', { class: 'box' }, icon('check')),
              category.label,
            );
            typeButtons.set(category.id, button);
            return button;
          })
        : [h('p', { class: 'muted small' }, t('filters.noTypes'))]),
    );
  };

  const paintStats = (inv: State['inventory']) => {
    if (!inv) {
      stats.replaceChildren();
      return;
    }
    stats.replaceChildren(...statLines(totals(inv)).map((line) => statRow(t(line.key), fmtInt(line.value))));
  };

  let lastInventory: State['inventory'] | undefined; // undefined — ещё ничего не рисовали
  let lastFilter: State['filter'] | null = null;
  let lastUntradable: boolean | null = null;
  return {
    update(s) {
      if (s.inventory === lastInventory && s.filter === lastFilter) return;
      const inventoryChanged = s.inventory !== lastInventory;
      const untradableChanged = s.filter.untradable !== lastUntradable;
      lastInventory = s.inventory;
      lastFilter = s.filter;
      lastUntradable = s.filter.untradable;
      if (document.activeElement !== search && search.value !== s.filter.search) search.value = s.filter.search;

      // Числа зависят от инвентаря и флажка «Нельзя передать» (он меняет «Все»); категории и итоги — только от
      // инвентаря. Остальные части фильтра меняют лишь отметки.
      const inv = s.inventory;
      if (inventoryChanged || untradableChanged) {
        const c = inv ? counts(inv, s.filter) : null;
        for (const o of shows) o.count.textContent = c ? fmtInt(c[o.value]) : '';
        untradableCount.textContent = c ? fmtInt(c.inert) : '';
        untradable.hidden = !c || c.inert === 0;
      }
      if (inventoryChanged) {
        paintTypes(inv ? categoriesOf(inv) : []);
        paintStats(inv);
      }
      for (const o of shows) {
        const on = s.filter.show === o.value;
        o.button.classList.toggle('on', on);
        o.button.setAttribute('aria-checked', String(on));
      }
      untradable.classList.toggle('on', s.filter.untradable);
      untradable.setAttribute('aria-checked', String(s.filter.untradable));
      for (const [id, button] of typeButtons) {
        const on = s.filter.categories.includes(id);
        button.classList.toggle('on', on);
        button.setAttribute('aria-checked', String(on));
      }
    },
  };
}
