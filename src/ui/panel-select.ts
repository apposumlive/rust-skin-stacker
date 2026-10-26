// Правая панель, пока операции нет: подсказка, один скин, несколько скинов.

import { clearSelection, showPlan } from '../actions';
import { api, asUiError } from '../api';
import { h, icon } from '../dom';
import { estimateSeconds, fmtDate, fmtDuration, fmtInt, iconUrl } from '../format';
import { errorText, t, tn } from '../i18n';
import { apartRecords, canCombine, clampCount, counts, hasStack, layoutOf, layoutText, splitCapacity } from '../model';
import type { State } from '../store';
import type { Inventory, Skin } from '../types';

export function picture(skin: Skin | undefined, size: number, cls: string): HTMLElement {
  return h('div', { class: cls }, skin?.icon ? h('img', { src: iconUrl(skin.icon, size), alt: '' }) : icon('photo-off'));
}

export function hintView(inventory: Inventory): HTMLElement {
  const allSingle = counts(inventory).stacks === 0;
  return h(
    'div',
    { class: 'panel hint' },
    h('div', { class: 'hint-icon' }, icon('hand-click')),
    h('h2', { class: 'plan-h' }, t('panel.hintTitle')),
    h('p', { class: 'muted' }, t('panel.hintClick')),
    h('p', { class: 'muted' }, t('panel.hintKeys')),
    h(
      'div',
      { class: 'sec' },
      h('p', {}, icon('arrows-split-2'), t('panel.hintSplitAll')),
      h('p', {}, icon('stack-push'), t('panel.hintCombineAll')),
    ),
    allSingle ? h('p', { class: 'note ok' }, icon('circle-check'), t('panel.allSingle')) : null,
  );
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
function splitOff(skin: Skin, capacity: number, delayMs: number): { section: HTMLElement; button: HTMLButtonElement } {
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
    { class: 'btn pri', type: 'button', onclick: () => void showPlan({ kind: 'splitOff', key: skin.key, count }) },
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

  function say(text: string, failed: boolean): void {
    preview.textContent = text;
    preview.classList.toggle('err', failed);
  }

  /** Спрашивает у ядра, что станет; ответ на прошлое число отбрасывается. */
  function refresh(): void {
    const mine = ++seq;
    api.preview({ kind: 'splitOff', key: skin.key, count }).then(
      (plan) => {
        const after = plan.after[0];
        // Строка уже пуста: set() убрал её при смене числа. Пустой ответ ничего к ней не добавляет.
        if (mine !== seq || !after) return;
        say(
          t('item.result', {
            layout: layoutText(after.stacks, after.singles, true),
            requests: tn('plan.requests', plan.requests),
            time: fmtDuration(estimateSeconds(plan.requests, delayMs)),
          }),
          false,
        );
      },
      (e: unknown) => {
        if (mine !== seq) return;
        say(errorText(asUiError(e)), true);
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
    say('', false);
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

export function itemView(skin: Skin, state: State): HTMLElement {
  const layout = layoutOf(skin);
  const main = skin.records[0];
  const apart = apartRecords(skin).length;
  const capacity = splitCapacity(skin);
  const split = capacity > 0 ? splitOff(skin, capacity, state.settings.delayMs) : null;
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
  return h(
    'div',
    { class: 'panel item' },
    picture(skin, 256, 'big'),
    h('h2', { class: 'iname' }, skin.name),
    h('p', { class: 'isub num' }, `${t('card.total', { count: fmtInt(skin.total) })} · ${layoutText(layout.stacks, layout.singles, true)}`),
    h(
      'dl',
      { class: 'kv' },
      fact(t('item.marketable'), yesNo(main?.marketable ?? false, main?.availableAfter ?? null)),
      fact(t('item.tradable'), yesNo(main?.tradable ?? false, main?.availableAfter ?? null)),
      fact(t('item.records'), h('b', { class: 'num' }, fmtInt(skin.records.length))),
    ),
    apart ? h('p', { class: 'note' }, icon('alert-triangle'), tn('item.apart', apart)) : null,
    split ? split.section : h('p', { class: 'note muted' }, icon('circle-check'), t('item.nothingToSplit')),
    split ? h('div', { class: 'acts' }, split.button, combine) : h('div', { class: 'acts one' }, combine),
    h('p', { class: 'foot' }, t('item.foot')),
  );
}

export function multiView(skins: Skin[]): HTMLElement {
  const pcs = skins.reduce((n, s) => n + s.total, 0);
  const keys = skins.map((s) => s.key);
  const shown = skins.slice(0, 8);
  return h(
    'div',
    { class: 'panel multi' },
    h(
      'div',
      { class: 'thumbs' },
      ...shown.map((s) => h('div', { class: 'thumb', title: s.name }, s.icon ? h('img', { src: iconUrl(s.icon, 96), alt: '' }) : icon('photo-off'))),
      skins.length > shown.length ? h('div', { class: 'thumb' }, t('multi.more', { count: fmtInt(skins.length - shown.length) })) : null,
    ),
    h('h2', { class: 'plan-h' }, t('multi.title', { items: tn('multi.items', skins.length), pcs: t('card.total', { count: fmtInt(pcs) }) })),
    h(
      'div',
      { class: 'acts one' },
      h(
        'button',
        { class: 'btn pri', type: 'button', disabled: !skins.some(hasStack), onclick: () => void showPlan({ kind: 'splitSelected', keys }) },
        icon('arrows-split-2'),
        t('multi.split'),
      ),
      h(
        'button',
        { class: 'btn sec', type: 'button', disabled: !skins.some(canCombine), onclick: () => void showPlan({ kind: 'combineSelected', keys }) },
        icon('stack-push'),
        t('multi.combine'),
      ),
    ),
    h('button', { class: 'link', type: 'button', onclick: clearSelection }, t('multi.clear')),
    h('p', { class: 'foot' }, t('item.foot')),
  );
}
