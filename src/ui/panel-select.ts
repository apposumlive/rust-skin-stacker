// Правая панель, пока операции нет: подсказка, одна карточка, несколько карточек.

import { clearSelection, showPlan } from '../actions';
import { api, asUiError } from '../api';
import { h, icon, type Child } from '../dom';
import { estimateSeconds, fmtDate, fmtDuration, fmtInt } from '../format';
import { errorText, t, tn } from '../i18n';
import { apartRecords, canCombine, canCombineCards, canSplitCards, cardLayout, clampCount, hasStack, layoutText, type Card } from '../model';
import type { State } from '../store';
import type { Inventory, Skin } from '../types';
import { itemImage } from './item-image';

export function picture(skin: Skin | undefined, size: number, cls: string): HTMLElement {
  return h('div', { class: cls }, itemImage(skin?.icon ?? null, size));
}

/**
 * Вид правой панели: содержимое прокручивается, кнопки закреплены снизу и видны при любой высоте окна.
 * Главный элемент вида помечен `data-main`: на него панель переводит фокус после смены вида.
 */
export function panelView(cls: string, body: Child[], dock: Child[] = []): HTMLElement {
  return h(
    'div',
    { class: `panel ${cls}` },
    h('div', { class: 'pbody' }, ...body),
    dock.some(Boolean) ? h('div', { class: 'dock' }, ...dock) : null,
  );
}

/** Заголовок, на который фокус переводится программно (Tab на нём не останавливается). */
export function mainHeading(cls: string, text: string): HTMLElement {
  return h('h2', { class: cls, tabindex: -1, 'data-main': true }, text);
}

export function hintView(inventory: Inventory): HTMLElement {
  const allSingle = !inventory.skins.some(hasStack);
  return panelView('hint', [
    h('div', { class: 'hint-icon' }, icon('hand-click')),
    mainHeading('plan-h', t('panel.hintTitle')),
    h('p', { class: 'muted' }, t('panel.hintClick')),
    h('p', { class: 'muted' }, t('panel.hintKeys')),
    h(
      'div',
      { class: 'sec' },
      h('p', {}, icon('arrows-split-2'), t('panel.hintSplitAll')),
      h('p', {}, icon('stack-push'), t('panel.hintCombineAll')),
    ),
    allSingle ? h('p', { class: 'note ok' }, icon('circle-check'), t('panel.allSingle')) : null,
  ]);
}

function yesNo(flag: boolean, availableAfter: string | null): HTMLElement {
  if (flag) return h('b', { class: 'yes' }, t('item.yes'));
  if (availableAfter) return h('b', { class: 'later' }, t('item.from', { date: fmtDate(availableAfter) }));
  return h('b', { class: 'no' }, t('item.no'));
}

function fact(label: string, value: HTMLElement): HTMLElement {
  return h('div', {}, h('dt', {}, label), h('dd', {}, value));
}

/** Пауза после последнего движения ползунка, после которой считается строка «Станет: …». */
const PREVIEW_DELAY_MS = 150;

/**
 * Блок «Отделить по одному». Строку «Станет: …» считает ядро, поэтому она совпадает с планом.
 * Если отделять можно только одну штуку (`capacity` 1), выбирать не из чего: ползунка и счётчика нет, остаются строка и кнопка.
 */
function splitOff(assetid: string, capacity: number, delayMs: number): { section: HTMLElement; button: HTMLButtonElement } {
  let count = 1;
  let seq = 0;
  let timer = 0;
  const value = h('input', {
    class: 'v num',
    type: 'number',
    min: 1,
    max: capacity,
    value: count,
    inputmode: 'numeric',
    'aria-label': t('item.count'),
  });
  const range = h('input', { class: 'range', type: 'range', min: 1, max: capacity, value: count, 'aria-label': t('item.count') });
  const preview = h('p', { class: 'preview num', 'aria-live': 'polite' });
  const label = h('span', {}, t('item.splitN', { count }));
  const button = h(
    'button',
    { class: 'btn pri', type: 'button', onclick: () => void showPlan({ kind: 'splitOff', assetid, count }) },
    icon('arrows-split-2'),
    label,
  );
  const less = h('button', { class: 'b', type: 'button', 'aria-label': t('item.less'), onclick: () => set(count - 1) }, icon('minus'));
  const more = h('button', { class: 'b', type: 'button', 'aria-label': t('item.more'), onclick: () => set(count + 1) }, icon('plus'));

  /** Поля и подписи под текущее число. */
  function paint(): void {
    value.value = String(count);
    range.value = String(count);
    range.style.setProperty('--fill', `${capacity > 1 ? ((count - 1) / (capacity - 1)) * 100 : 100}%`);
    label.textContent = t('item.splitN', { count: fmtInt(count) });
    less.disabled = count <= 1;
    more.disabled = count >= capacity;
  }

  function say(parts: Array<Node | string>, failed: boolean): void {
    preview.replaceChildren(...parts);
    preview.classList.toggle('err', failed);
  }

  /** Спрашивает у ядра, что станет; ответ на прошлое число отбрасывается. */
  function refresh(): void {
    const mine = ++seq;
    api.preview({ kind: 'splitOff', assetid, count }).then(
      (plan) => {
        const after = plan.cards[0];
        // Строка уже пуста: set() убрал её при смене числа. Пустой ответ ничего к ней не добавляет.
        if (mine !== seq || !after) return;
        const layout = cardLayout(after);
        // «Станет:» и стоимость приглушены, раскладка выделена — как на макете.
        say(
          [
            t('item.becomes'),
            ' ',
            h('b', {}, layoutText(layout.stacks, layout.singles, true)),
            ' · ',
            t('item.cost', { requests: tn('plan.requests', plan.requests), time: fmtDuration(estimateSeconds(plan.requests, delayMs)) }),
          ],
          false,
        );
      },
      (e: unknown) => {
        if (mine !== seq) return;
        say([errorText(asUiError(e))], true);
      },
    );
  }

  function set(next: number): void {
    const was = count;
    count = clampCount(next, capacity);
    paint();
    if (count === was) return;
    // Строка от прошлого числа к новому не относится: убираем её и считаем заново, когда движение кончится.
    seq += 1;
    say([], false);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      // Панель могла пересобраться, пока ждали: тогда этот блок уже не на экране.
      if (section.isConnected) refresh();
    }, PREVIEW_DELAY_MS);
  }

  range.addEventListener('input', () => set(Number(range.value)));
  value.addEventListener('change', () => set(Number(value.value)));
  paint();
  refresh();

  const section = h(
    'section',
    { class: 'sec' },
    h('div', { class: 'sec-h' }, h('span', {}, t('item.splitOff')), capacity > 1 ? h('span', { class: 'amt' }, less, value, more) : null),
    capacity > 1 ? range : null,
    capacity > 1 ? h('div', { class: 'ticks num' }, h('span', {}, '1'), h('span', {}, fmtInt(capacity))) : null,
    preview,
  );
  return { section, button };
}

export function itemView({ skin, record }: Card, state: State): HTMLElement {
  const apart = apartRecords(skin).length;
  const capacity = record.amount - 1;
  const split = capacity > 0 ? splitOff(record.assetid, capacity, state.settings.delayMs) : null;
  const combine = h(
    'button',
    {
      class: 'btn sec',
      type: 'button',
      disabled: !canCombine(skin),
      onclick: () => void showPlan({ kind: 'combineSelected', keys: [skin.key] }),
    },
    icon('stack-push'),
    t('item.combine'),
  );
  return panelView(
    'item',
    [
      picture(skin, 256, 'big'),
      mainHeading('iname', skin.name),
      h('p', { class: 'isub num' }, record.amount > 1 ? t('item.stack', { count: fmtInt(record.amount) }) : t('item.single')),
      h(
        'dl',
        { class: 'kv' },
        fact(t('item.marketable'), yesNo(record.marketable, record.availableAfter)),
        fact(t('item.tradable'), yesNo(record.tradable, record.availableAfter)),
        fact(t('item.skinTotal'), h('b', { class: 'num' }, t('card.total', { count: fmtInt(skin.total) }))),
        fact(t('item.records'), h('b', { class: 'num' }, fmtInt(skin.records.length))),
      ),
      apart ? h('p', { class: 'note' }, icon('alert-triangle'), tn('item.apart', apart)) : null,
      split ? split.section : h('p', { class: 'note muted' }, icon('circle-check'), t('item.nothingToSplit')),
    ],
    [
      // Кнопки друг под другом: «Собрать все такие» в половину узкой панели не помещается.
      h('div', { class: 'acts one' }, split?.button ?? null, combine),
      h('p', { class: 'foot' }, t('item.foot')),
    ],
  );
}

export function multiView(cards: Card[]): HTMLElement {
  const pcs = cards.reduce((n, c) => n + c.record.amount, 0);
  const assetids = cards.map((c) => c.record.assetid);
  const shown = cards.slice(0, 8);
  return panelView(
    'multi',
    [
      h(
        'div',
        { class: 'thumbs' },
        ...shown.map((c) => h('div', { class: 'thumb', title: c.skin.name }, itemImage(c.skin.icon, 96))),
        cards.length > shown.length ? h('div', { class: 'thumb' }, t('multi.more', { count: fmtInt(cards.length - shown.length) })) : null,
      ),
      mainHeading('plan-h', t('multi.title', { items: tn('multi.items', cards.length), pcs: t('card.total', { count: fmtInt(pcs) }) })),
      h('button', { class: 'link', type: 'button', onclick: clearSelection }, t('multi.clear')),
    ],
    [
      h(
        'div',
        { class: 'acts one' },
        h(
          'button',
          { class: 'btn pri', type: 'button', disabled: !canSplitCards(cards), onclick: () => void showPlan({ kind: 'splitRecords', assetids }) },
          icon('arrows-split-2'),
          t('multi.split'),
        ),
        h(
          'button',
          { class: 'btn sec', type: 'button', disabled: !canCombineCards(cards), onclick: () => void showPlan({ kind: 'combineRecords', assetids }) },
          icon('stack-push'),
          t('multi.combine'),
        ),
      ),
      h('p', { class: 'foot' }, t('item.foot')),
    ],
  );
}
