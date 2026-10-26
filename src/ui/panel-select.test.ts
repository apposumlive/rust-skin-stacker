import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { api as realApi, useApi, type Api } from '../api';
import { errorText, setLang, t } from '../i18n';
import type { State } from '../store';
import type { InvRecord, Operation, Plan, Skin } from '../types';
import { byClass, byTag, fakeDocument, findAll, fire, type FakeEl } from './fake-dom';
import { itemView } from './panel-select';

function rec(assetid: string, amount: number): InvRecord {
  return { assetid, classid: 'c1', instanceid: '0', amount, tradable: true, marketable: true, availableAfter: null };
}

const skinOf = (amount: number): Skin => ({ key: 'A', name: 'Skin A', icon: null, category: null, total: amount, records: [rec('1001', amount)] });
const state = { settings: { language: null, delayMs: 1500 } } as State;

/** Ответ ядра на «Отделить N» для стопки из 8. */
function planFor(op: Operation): Plan {
  const n = op.kind === 'splitOff' ? op.count : 0;
  return { operation: op, requests: n, stacks: 1, queue: [], more: 0, after: [{ key: 'A', stacks: [8 - n], singles: n + 1 }] };
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
    expect(preview).toHaveBeenCalledWith({ kind: 'splitOff', key: 'A', count: 1 });
    await flush();
    expect(text(line(el))).toContain('1 request');
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
    expect(preview).toHaveBeenLastCalledWith({ kind: 'splitOff', key: 'A', count: 5 });
    expect(text(line(el))).toContain('5 requests');
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
    expect(preview).toHaveBeenLastCalledWith({ kind: 'splitOff', key: 'A', count: 3 });
    const field = numberOf(el);
    field.value = '6';
    fire(field, 'change');
    await vi.advanceTimersByTimeAsync(150);
    expect(preview).toHaveBeenCalledTimes(3);
    expect(preview).toHaveBeenLastCalledWith({ kind: 'splitOff', key: 'A', count: 6 });
  });

  it('removes the line of the old number as soon as the number changes', async () => {
    const el = itemView(skinOf(8), state);
    await flush();
    expect(text(line(el))).not.toBe('');
    drag(el, 4);
    expect(text(line(el))).toBe('');
    await vi.advanceTimersByTimeAsync(150);
    expect(text(line(el))).toContain('4 requests');
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
    expect(text(line(el))).toContain('5 requests');
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
    preview.mockImplementation((op) => Promise.resolve({ ...planFor(op), after: [] }));
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
    expect(preview).toHaveBeenLastCalledWith({ kind: 'splitOff', key: 'A', count: 4 });
    drag(el, 5);
    slow.resolve(planFor({ kind: 'splitOff', key: 'A', count: 4 }));
    await flush();
    expect(text(line(el))).toBe('');
    await vi.advanceTimersByTimeAsync(150);
    expect(text(line(el))).toContain('5 requests');
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
    expect(preview).toHaveBeenCalledWith({ kind: 'splitOff', key: 'A', count: 1 });
    expect(text(line(el))).toContain('1 request');
  });
});

describe('item view', () => {
  it('builds the «becomes» line with the layout in bold between the muted parts', async () => {
    const el = itemView(skinOf(8), state);
    await flush();
    const bold = byTag(line(el), 'b');
    expect(bold).toHaveLength(1);
    expect(bold[0].textContent).toBe('stack ×7 and 2 singles');
    expect(text(line(el))).toBe(`${t('item.becomes')} stack ×7 and 2 singles · ${t('item.cost', { requests: '1 request', time: '~1 s' })}`);
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
