import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { api as realApi, useApi, type Api } from '../api';
import { errorText, setLang, t } from '../i18n';
import { getState, initState, setState, type State } from '../store';
import type { Card } from '../model';
import type { InvRecord, Operation, Plan, Skin } from '../types';
import { byClass, byTag, fakeDocument, findAll, fire, type FakeEl } from './fake-dom';
import { itemView, multiView } from './panel-select';

function rec(assetid: string, amount: number, instanceid = '0'): InvRecord {
  return { assetid, classid: 'c1', instanceid, amount, tradable: true, marketable: true, availableAfter: null };
}

const skinWith = (key: string, records: InvRecord[]): Skin => ({
  key,
  name: `Skin ${key}`,
  icon: null,
  category: null,
  total: records.reduce((n, r) => n + r.amount, 0),
  records,
});

/** Карточка скина A с одной записью. */
const skinOf = (amount: number): Card => {
  const skin = skinWith('A', [rec('1001', amount)]);
  return { skin, record: skin.records[0] };
};

/** Карточки записей скина: по одной на запись. */
const cardsOf = (skin: Skin): Card[] => skin.records.map((record) => ({ skin, record }));
const state = { settings: { language: null, delayMs: 1500, uiScale: 100 } } as State;

/** Ответ ядра на «Отделить N» для стопки из 8. */
function planFor(op: Operation): Plan {
  const n = op.kind === 'splitOff' ? op.count : 0;
  return { operation: op, requests: n, stacks: 1, queue: [], more: 0, cards: [{ assetid: '1001', amount: 8 - n, singles: n }] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let preview: Mock<(op: Operation) => Promise<Plan>>;

const flush = () => vi.advanceTimersByTimeAsync(0);
const text = (el: unknown) => (el as FakeEl).textContent;
const line = (root: unknown) => byClass(root, 'preview')[0];
const rangeOf = (root: unknown) => byTag(root, 'input').find((i) => i.attrs.get('type') === 'range');
const numberOf = (root: unknown) => byTag(root, 'input').find((i) => i.attrs.get('type') === 'number')!;

function drag(root: unknown, count: number): void {
  const range = rangeOf(root)!;
  range.value = String(count);
  fire(range, 'input');
}

beforeEach(() => {
  setLang('en');
  initState({ ...state, panel: { kind: 'selection' }, selected: [], anchor: null });
  vi.useFakeTimers();
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', globalThis);
  preview = vi.fn((op: Operation) => Promise.resolve(planFor(op)));
  useApi({ preview } as unknown as Api);
});

afterEach(() => {
  useApi(realApi);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('split-off block', () => {
  it('asks the core for the first line at once', async () => {
    const el = itemView(skinOf(8), state);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledWith({ kind: 'splitOff', assetid: '1001', count: 1 });
    await flush();
    expect(text(line(el))).toContain('1\u00a0request');
  });

  it('asks again only after the slider stops moving', async () => {
    const el = itemView(skinOf(8), state);
    await flush();
    for (const n of [2, 3, 4, 5]) {
      drag(el, n);
      await vi.advanceTimersByTimeAsync(40);
    }
    expect(preview).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(110);
    expect(preview).toHaveBeenCalledTimes(2);
    expect(preview).toHaveBeenLastCalledWith({ kind: 'splitOff', assetid: '1001', count: 5 });
    expect(text(line(el))).toContain('5\u00a0requests');
  });

  it('debounces the plus, minus and number field the same way', async () => {
    const el = itemView(skinOf(8), state);
    await flush();
    const [less, more] = byClass(el, 'b');
    fire(more, 'click');
    fire(more, 'click');
    fire(more, 'click');
    fire(less, 'click');
    expect(preview).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(150);
    expect(preview).toHaveBeenCalledTimes(2);
    expect(preview).toHaveBeenLastCalledWith({ kind: 'splitOff', assetid: '1001', count: 3 });
    const field = numberOf(el);
    field.value = '6';
    fire(field, 'change');
    await vi.advanceTimersByTimeAsync(150);
    expect(preview).toHaveBeenCalledTimes(3);
    expect(preview).toHaveBeenLastCalledWith({ kind: 'splitOff', assetid: '1001', count: 6 });
  });

  it('removes the line of the old number as soon as the number changes', async () => {
    const el = itemView(skinOf(8), state);
    await flush();
    expect(text(line(el))).not.toBe('');
    drag(el, 4);
    expect(text(line(el))).toBe('');
    await vi.advanceTimersByTimeAsync(150);
    expect(text(line(el))).toContain('4\u00a0requests');
  });

  it('shows the error text when the preview fails, never the old line', async () => {
    const el = itemView(skinOf(8), state);
    await flush();
    preview.mockImplementation(() => Promise.reject({ code: 'http', status: 502 }));
    drag(el, 4);
    await vi.advanceTimersByTimeAsync(150);
    expect(text(line(el))).toBe(errorText({ code: 'http', status: 502 }));
    expect(line(el).classList.contains('err')).toBe(true);

    preview.mockImplementation((op) => Promise.resolve(planFor(op)));
    drag(el, 5);
    await vi.advanceTimersByTimeAsync(150);
    expect(text(line(el))).toContain('5\u00a0requests');
    expect(line(el).classList.contains('err')).toBe(false);
  });

  it('shows the generic error text for an error that is not a core error', async () => {
    const el = itemView(skinOf(8), state);
    await flush();
    preview.mockImplementation(() => Promise.reject(new Error('boom')));
    drag(el, 4);
    await vi.advanceTimersByTimeAsync(150);
    expect(text(line(el))).toBe(t('error.unknown'));
  });

  it('clears the line when the preview comes back empty', async () => {
    const el = itemView(skinOf(8), state);
    await flush();
    expect(text(line(el))).not.toBe('');
    preview.mockImplementation((op) => Promise.resolve({ ...planFor(op), cards: [] }));
    drag(el, 4);
    await vi.advanceTimersByTimeAsync(150);
    expect(text(line(el))).toBe('');
  });

  it('drops the answer for a number that is no longer on the slider', async () => {
    const el = itemView(skinOf(8), state);
    await flush();
    const slow = deferred<Plan>();
    preview.mockImplementationOnce(() => slow.promise);
    drag(el, 4);
    await vi.advanceTimersByTimeAsync(150);
    expect(preview).toHaveBeenLastCalledWith({ kind: 'splitOff', assetid: '1001', count: 4 });
    drag(el, 5);
    slow.resolve(planFor({ kind: 'splitOff', assetid: '1001', count: 4 }));
    await flush();
    expect(text(line(el))).toBe('');
    await vi.advanceTimersByTimeAsync(150);
    expect(text(line(el))).toContain('5\u00a0requests');
  });

  it('does not ask after the panel was rebuilt', async () => {
    const el = itemView(skinOf(8), state);
    await flush();
    drag(el, 4);
    byTag(el, 'section')[0].isConnected = false;
    await vi.advanceTimersByTimeAsync(300);
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it('clamps a typed number and keeps the field, the label and the buttons in step', async () => {
    const el = itemView(skinOf(8), state);
    const field = numberOf(el);
    const [less, more] = byClass(el, 'b');
    const button = byClass(el, 'pri')[0];
    expect(less.disabled).toBe(true);
    field.value = '99';
    fire(field, 'change');
    expect(field.value).toBe('7');
    expect(button.textContent).toBe(t('item.splitN', { count: '7' }));
    expect(more.disabled).toBe(true);
    expect(less.disabled).toBe(false);
    field.value = 'abc';
    fire(field, 'change');
    expect(field.value).toBe('1');
    expect(button.textContent).toBe(t('item.splitN', { count: '1' }));
    // 99 → 1 за одну паузу: оба изменения слились в один запрос.
    await vi.advanceTimersByTimeAsync(150);
    expect(preview).toHaveBeenCalledTimes(2);
  });

  it('has no slider, counter or ticks when only one piece can be split off', async () => {
    const el = itemView(skinOf(2), state);
    await flush();
    expect(rangeOf(el)).toBeUndefined();
    expect(byTag(el, 'input')).toHaveLength(0);
    expect(byClass(el, 'ticks')).toHaveLength(0);
    expect(byClass(el, 'amt')).toHaveLength(0);
    expect(byClass(el, 'pri')[0].textContent).toBe(t('item.splitN', { count: '1' }));
    expect(preview).toHaveBeenCalledWith({ kind: 'splitOff', assetid: '1001', count: 1 });
    expect(text(line(el))).toContain('1\u00a0request');
  });
});

describe('item view', () => {
  it('builds the «becomes» line with the layout in bold between the muted parts', async () => {
    const el = itemView(skinOf(8), state);
    await flush();
    const bold = byTag(line(el), 'b');
    expect(bold).toHaveLength(1);
    expect(bold[0].textContent).toBe('stack ×7 and 1\u00a0single');
    expect(text(line(el))).toBe(`${t('item.becomes')} stack ×7 and 1\u00a0single · ${t('item.cost', { requests: '1\u00a0request', time: '~1\u00a0s' })}`);
  });

  it('keeps the actions docked below the scrolling part and focuses the heading', () => {
    const el = itemView(skinOf(8), state);
    const dock = byClass(el, 'dock')[0];
    expect(byTag(dock, 'button').map((b) => b.textContent)).toEqual([t('item.splitN', { count: '1' }), t('item.combine')]);
    expect(byClass(byClass(el, 'pbody')[0], 'acts')).toHaveLength(0);
    const main = findAll(el, (node) => node.attrs.has('data-main'));
    expect(main.map((node) => node.tag)).toEqual(['h2']);
    expect(main[0].textContent).toBe('Skin A');
  });
});

describe('item view of one card', () => {
  const sub = (el: unknown) => text(byClass(el, 'isub')[0]);
  const factsOf = (el: unknown) => byTag(byClass(el, 'kv')[0], 'div').map((d) => text(d));

  it('names a stack by its amount and lets the slider reach one less', async () => {
    const el = itemView(skinOf(10), state);
    await flush();
    expect(sub(el)).toBe('Stack ×10');
    expect(rangeOf(el)!.attrs.get('max')).toBe('9');
    expect(text(byClass(el, 'ticks')[0])).toBe('19');
    expect(byClass(el, 'pri')[0].textContent).toBe(t('item.splitN', { count: '1' }));
  });

  it('sends splitOff with the assetid from both the preview and the button', async () => {
    const el = itemView(skinOf(10), state);
    await flush();
    drag(el, 4);
    await vi.advanceTimersByTimeAsync(150);
    expect(preview).toHaveBeenLastCalledWith({ kind: 'splitOff', assetid: '1001', count: 4 });
    fire(byClass(el, 'pri')[0], 'click');
    await flush();
    expect(preview).toHaveBeenLastCalledWith({ kind: 'splitOff', assetid: '1001', count: 4 });
    expect(getState().panel).toMatchObject({ kind: 'plan', plan: { operation: { kind: 'splitOff', assetid: '1001', count: 4 } } });
  });

  it('writes «Becomes» for this stack only', async () => {
    const el = itemView(skinOf(8), state);
    await flush();
    drag(el, 3);
    await vi.advanceTimersByTimeAsync(150);
    expect(byTag(line(el), 'b')[0].textContent).toBe('stack ×5 and 3\u00a0singles');
  });

  it('shows a single item without a slider, a button or a request to the core', async () => {
    const el = itemView(skinOf(1), state);
    await flush();
    expect(sub(el)).toBe(t('item.single'));
    expect(rangeOf(el)).toBeUndefined();
    expect(byTag(el, 'input')).toHaveLength(0);
    expect(preview).not.toHaveBeenCalled();
    expect(text(el)).toContain(t('item.nothingToSplit'));
    expect(byClass(el, 'acts')[0].classes.has('one')).toBe(true);
    expect(byTag(byClass(el, 'dock')[0], 'button').map((b) => b.textContent)).toEqual([t('item.combine')]);
  });

  it('lists the facts of this entry and the totals of the skin', async () => {
    const skin = skinWith('A', [
      { ...rec('1001', 10), tradable: false, availableAfter: '2026-11-20T00:00:00Z' },
      rec('1002', 3),
    ]);
    const el = itemView({ skin, record: skin.records[0] }, state);
    await flush();
    const facts = factsOf(el);
    expect(facts[0]).toBe(`${t('item.marketable')}${t('item.yes')}`);
    expect(facts[1]).toContain(t('item.tradable'));
    expect(facts[1]).not.toContain(t('item.yes'));
    expect(facts[2]).toBe(`${t('item.skinTotal')}${t('card.total', { count: '13' })}`);
    expect(facts[3]).toBe(`${t('item.records')}2`);
  });

  it('warns about entries of another type, by the skin', async () => {
    const skin = skinWith('A', [rec('1001', 5), rec('1002', 2, '9')]);
    const el = itemView({ skin, record: skin.records[1] }, state);
    await flush();
    expect(byClass(el, 'note').map((n) => n.textContent)).toContain(t('item.apart_one', { count: '1' }));
  });

  describe('«Combine all of this kind»', () => {
    const combineButton = (el: unknown) => byTag(byClass(el, 'dock')[0], 'button').find((b) => b.textContent === t('item.combine'))!;

    it('sends combineSelected with the key of the skin', async () => {
      const skin = skinWith('A', [rec('1001', 5), rec('1002', 2)]);
      const el = itemView({ skin, record: skin.records[1] }, state);
      await flush();
      expect(combineButton(el).disabled).toBe(false);
      fire(combineButton(el), 'click');
      await flush();
      expect(preview).toHaveBeenLastCalledWith({ kind: 'combineSelected', keys: ['A'] });
    });

    it('is off when nothing in the skin combines', () => {
      expect(combineButton(itemView(skinOf(5), state)).disabled).toBe(true);
      const apart = skinWith('A', [rec('1001', 5), rec('1002', 2, '9')]);
      expect(combineButton(itemView({ skin: apart, record: apart.records[0] }, state)).disabled).toBe(true);
    });
  });
});

describe('view of several cards', () => {
  const buttons = (el: unknown) => byTag(byClass(el, 'dock')[0], 'button');

  it('counts the cards and the pieces in the title', () => {
    const el = multiView(cardsOf(skinWith('A', [rec('a1', 10), rec('a2', 5)])));
    expect(text(byClass(el, 'plan-h')[0])).toBe('Selected: 2\u00a0items, 15\u00a0pcs');
  });

  it('shows up to eight thumbnails and «+N» for the rest', () => {
    const records = Array.from({ length: 11 }, (_, i) => rec(`a${i}`, 1));
    const thumbs = byClass(multiView(cardsOf(skinWith('A', records))), 'thumb');
    expect(thumbs).toHaveLength(9);
    expect(text(thumbs[8])).toBe('+3');
    expect(byClass(multiView(cardsOf(skinWith('A', records.slice(0, 8)))), 'thumb')).toHaveLength(8);
  });

  it('sends the chosen assetids to «Split selected» and «Combine selected»', async () => {
    const el = multiView(cardsOf(skinWith('A', [rec('a1', 10), rec('a2', 5), rec('a3', 1)])));
    const [split, combine] = buttons(el);
    expect(split.textContent).toBe(t('multi.split'));
    expect(combine.textContent).toBe(t('multi.combine'));
    expect([split.disabled, combine.disabled]).toEqual([false, false]);
    fire(split, 'click');
    await flush();
    expect(preview).toHaveBeenLastCalledWith({ kind: 'splitRecords', assetids: ['a1', 'a2', 'a3'] });
    fire(combine, 'click');
    await flush();
    expect(preview).toHaveBeenLastCalledWith({ kind: 'combineRecords', assetids: ['a1', 'a2', 'a3'] });
  });

  it('turns «Split selected» off when no stack is chosen', () => {
    const el = multiView(cardsOf(skinWith('A', [rec('a1', 1), rec('a2', 1)])));
    expect(buttons(el).map((b) => b.disabled)).toEqual([true, false]);
  });

  it('turns «Combine selected» off when no two cards share a skin and a type', () => {
    const typed = cardsOf(skinWith('A', [rec('a1', 3), rec('a2', 2, '9')]));
    expect(buttons(multiView(typed)).map((b) => b.disabled)).toEqual([false, true]);
    const [a] = cardsOf(skinWith('A', [rec('a1', 3)]));
    const [b] = cardsOf(skinWith('B', [rec('b1', 3)]));
    expect(buttons(multiView([a, b])).map((x) => x.disabled)).toEqual([false, true]);
  });

  it('clears the selection with «Clear selection»', () => {
    setState({ selected: ['a1', 'a2'], anchor: 'a2' });
    const el = multiView(cardsOf(skinWith('A', [rec('a1', 3), rec('a2', 2)])));
    fire(byClass(el, 'link')[0], 'click');
    expect(getState()).toMatchObject({ selected: [], anchor: null });
  });
});
