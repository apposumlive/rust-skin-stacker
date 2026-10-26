import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fmtDuration } from '../format';
import { setLang, t } from '../i18n';
import type { Panel, State } from '../store';
import type { Inventory, InvRecord, Plan, Skin } from '../types';
import { byClass, byTag, FakeEl, fakeDocument, findAll } from './fake-dom';
import { patchRunning, planView, resultView, runningView } from './panel-run';

const NOW = 1_700_000_000_000;

function rec(assetid: string, amount: number): InvRecord {
  return { assetid, classid: 'c1', instanceid: '0', amount, tradable: true, marketable: true, availableAfter: null };
}

const skin: Skin = { key: 'A', name: 'Skin A', icon: null, category: null, total: 8, records: [rec('1001', 8)] };
const inventory: Inventory = { skins: [skin], unreadable: [] };
const state = { inventory, settings: { language: null, delayMs: 1500 } } as State;

const plan: Plan = { operation: { kind: 'splitAll' }, requests: 4, stacks: 1, queue: [{ key: 'A', amount: 8, requests: 4 }], more: 0, after: [] };
const empty: Plan = { ...plan, requests: 0, stacks: 0, queue: [] };

type Running = Extract<Panel, { kind: 'running' }>;
type Result = Extract<Panel, { kind: 'result' }>;

/** Главный элемент вида: на него панель переводит фокус после смены вида. */
const mains = (root: unknown) => findAll(root, (el) => el.attrs.has('data-main'));
/** Кнопки в закреплённом снизу блоке. */
const docked = (root: unknown) => byClass(root, 'dock').flatMap((dock) => byTag(dock, 'button'));
const texts = (els: FakeEl[]) => els.map((el) => el.textContent);

function running(patch: Partial<Running> = {}): Running {
  return { kind: 'running', plan, done: 0, total: 4, errors: 0, key: '', waitUntil: null, stopping: false, ...patch };
}

beforeEach(() => {
  setLang('en');
  vi.stubGlobal('document', fakeDocument);
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('running view', () => {
  it('keeps its nodes while progress events patch it, so Stop keeps focus and the click', () => {
    const tick = vi.fn();
    const el = runningView(running(), state, tick);
    const stop = byTag(el, 'button')[0];
    const fill = byClass(el, 'fill')[0];
    const bar = byClass(el, 'progress')[0];
    expect(stop.disabled).toBe(false);
    expect(stop.textContent).toBe(t('run.stop'));

    for (const done of [1, 2, 3]) {
      expect(patchRunning(el, running({ done, errors: done - 1, key: 'A' }), state, tick)).toBe(true);
      expect(byTag(el, 'button')).toHaveLength(1);
      expect(byTag(el, 'button')[0]).toBe(stop);
      expect(byClass(el, 'fill')[0]).toBe(fill);
      expect(byClass(el, 'progress')[0]).toBe(bar);
    }
    expect(fill.style.width).toBe('75%');
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('4');
    expect(el.textContent).toContain(t('run.progress', { done: '3', total: '4', errors: '2' }));
    expect(el.textContent).toContain(t('run.current', { name: 'Skin A' }));
  });

  it('patches the stop button in place when stopping starts', () => {
    const tick = vi.fn();
    const el = runningView(running(), state, tick);
    const stop = byTag(el, 'button')[0];
    patchRunning(el, running({ stopping: true }), state, tick);
    expect(byTag(el, 'button')[0]).toBe(stop);
    expect(stop.disabled).toBe(true);
    expect(stop.textContent).toBe(t('run.stopping'));
    patchRunning(el, running({ stopping: false }), state, tick);
    expect(stop.disabled).toBe(false);
    expect(stop.textContent).toBe(t('run.stop'));
  });

  it('hides the current item when there is none', () => {
    const el = runningView(running(), state, vi.fn());
    const current = byClass(el, 'muted')[0];
    expect(current.hidden).toBe(true);
    patchRunning(el, running({ key: 'A' }), state, vi.fn());
    expect(current.hidden).toBe(false);
    patchRunning(el, running({ key: '' }), state, vi.fn());
    expect(current.hidden).toBe(true);
  });

  it('counts the 429 wait down, formats the seconds and hides the line at zero', () => {
    const tick = vi.fn();
    const el = runningView(running(), state, tick);
    const wait = byClass(el, 'wait')[0];
    expect(wait.hidden).toBe(true);

    patchRunning(el, running({ waitUntil: NOW + 29_001 }), state, tick);
    expect(wait.hidden).toBe(false);
    expect(wait.textContent).toBe(t('run.waiting', { seconds: '30' }));
    expect(tick).toHaveBeenCalledTimes(1);

    const show = tick.mock.calls[0][0] as () => void;
    vi.mocked(Date.now).mockReturnValue(NOW + 1_000);
    show();
    expect(wait.textContent).toBe(t('run.waiting', { seconds: '29' }));
    vi.mocked(Date.now).mockReturnValue(NOW + 29_001);
    show();
    expect(wait.hidden).toBe(true);
    expect(wait.textContent).toBe('');
    vi.mocked(Date.now).mockReturnValue(NOW + 40_000);
    show();
    expect(wait.hidden).toBe(true);
  });

  it('formats the wait seconds with the language separator', () => {
    const el = runningView(running({ waitUntil: NOW + 1_234_000 }), state, vi.fn());
    expect(byClass(el, 'wait')[0].textContent).toBe(t('run.waiting', { seconds: '1,234' }));
  });

  it('shows an already expired wait as hidden and drops the line when the wait is cleared', () => {
    const tick = vi.fn();
    const el = runningView(running({ waitUntil: NOW - 500 }), state, tick);
    const wait = byClass(el, 'wait')[0];
    expect(wait.hidden).toBe(true);
    patchRunning(el, running({ waitUntil: NOW + 5_000 }), state, tick);
    expect(wait.hidden).toBe(false);
    patchRunning(el, running({ waitUntil: null }), state, tick);
    expect(wait.hidden).toBe(true);
    expect(wait.textContent).toBe('');
  });

  it('does not patch a view that is not the running view', () => {
    expect(patchRunning(new FakeEl('div') as unknown as HTMLElement, running(), state, vi.fn())).toBe(false);
  });
});

describe('plan view', () => {
  it('tells that the inventory changed when the new plan has requests', () => {
    expect(planView(plan, true, state).textContent).toContain(t('plan.changed'));
    expect(planView(plan, false, state).textContent).not.toContain(t('plan.changed'));
  });

  it('tells that the inventory changed when the new plan has no requests', () => {
    const view = planView(empty, true, state);
    expect(view.textContent).toContain(t('plan.changed'));
    expect(view.textContent).toContain(t('plan.nothingSplit'));
    expect(view.textContent).toContain(t('plan.close'));
    const plain = planView(empty, false, state);
    expect(plain.textContent).not.toContain(t('plan.changed'));
    expect(plain.textContent).toContain(t('plan.nothingSplit'));
  });
});

describe('main element and docked buttons', () => {
  it('focuses Run in the plan and keeps Run and Cancel docked below the scrolling list', () => {
    const view = planView(plan, false, state);
    expect(texts(mains(view))).toEqual([t('plan.run')]);
    expect(texts(docked(view))).toEqual([t('plan.run'), t('plan.cancel')]);
    expect(byClass(byClass(view, 'pbody')[0], 'queue')).toHaveLength(1);
  });

  it('focuses Close in a plan with nothing to do', () => {
    expect(texts(mains(planView(empty, false, state)))).toEqual([t('plan.close')]);
  });

  it('focuses Stop while the run goes and names the progress bar like the heading', () => {
    const view = runningView(running(), state, vi.fn());
    expect(texts(mains(view))).toEqual([t('run.stop')]);
    expect(texts(docked(view))).toEqual([t('run.stop')]);
    const heading = t('run.title', { op: t('op.splitAll') });
    expect(byClass(view, 'progress')[0].getAttribute('aria-label')).toBe(heading);
  });

  it('focuses the heading of the result, which Tab skips', () => {
    const heading = mains(resultView(result()));
    expect(heading).toHaveLength(1);
    expect(heading[0].tag).toBe('h2');
    expect(heading[0].getAttribute('tabindex')).toBe('-1');
  });
});

describe('plan time', () => {
  it('does not say «about» twice', () => {
    for (const lang of ['en', 'ru'] as const) {
      setLang(lang);
      const label = t('plan.time');
      const value = fmtDuration(180);
      expect(value.startsWith('~')).toBe(true);
      expect(label).not.toMatch(/about|примерно/);
    }
  });
});

function result(over: Partial<Result> = {}): Result {
  return {
    kind: 'result',
    plan,
    outcome: { reason: 'finished', done: 72, errors: 0, total: 72 },
    reconciliation: { before: 121, after: 121, mismatches: [] },
    stacks: 0,
    ...over,
  };
}

describe('result view', () => {
  const buttons = (view: unknown) => byTag(view, 'button');
  const primary = (view: unknown) => texts(buttons(view).filter((b) => b.classes.has('pri')));

  it('puts the buttons in one column and makes Close the main one when the count was checked', () => {
    const view = resultView(result());
    expect(byClass(view, 'acts')[0].classes.has('one')).toBe(true);
    expect(texts(docked(view))).toEqual([t('result.close'), t('result.reload'), t('result.copyLog')]);
    expect(primary(view)).toEqual([t('result.close')]);
  });

  it('makes Re-read the main button only when there is no check', () => {
    const view = resultView(result({ reconciliation: null, stacks: null }));
    expect(texts(docked(view))).toEqual([t('result.reload'), t('result.copyLog'), t('result.close')]);
    expect(primary(view)).toEqual([t('result.reload')]);
    expect(view.textContent).toContain(t('result.checkUnavailable'));
  });

  it('asks for a new token when Steam rejected the token', () => {
    const view = resultView(result({ outcome: { reason: 'tokenRejected', done: 3, errors: 0, total: 72 }, reconciliation: null, stacks: null }));
    expect(texts(docked(view))).toEqual([t('result.newToken'), t('result.copyLog'), t('result.close')]);
    expect(primary(view)).toEqual([t('result.newToken')]);
    expect(view.textContent).toContain(t('result.checkTokenRejected'));
    expect(view.textContent).not.toContain(t('result.checkUnavailable'));
    expect(view.textContent).not.toContain(t('result.reload'));
  });

  it('shows the facts it knows: requests, errors, pieces and stacks now', () => {
    const view = resultView(result({ outcome: { reason: 'stoppedByUser', done: 14, errors: 2, total: 72 }, stacks: 5 }));
    const facts = byClass(view, 'fact').map((f) => f.textContent);
    expect(facts).toEqual([
      t('result.requests') + t('result.requestsValue', { done: '14', total: '72' }),
      t('result.errors') + '2',
      t('result.pieces') + t('result.piecesValue', { before: '121', after: '121' }),
      t('result.stacksNow') + '5',
    ]);
  });

  it('leaves out the facts it does not know', () => {
    const view = resultView(result({ reconciliation: null, stacks: null }));
    const facts = byClass(view, 'fact').map((f) => f.textContent);
    expect(facts).toHaveLength(2);
    expect(view.textContent).not.toContain(t('result.pieces'));
    expect(view.textContent).not.toContain(t('result.stacksNow'));
  });

  it('says the count matches only when the sums are equal and no skin differs', () => {
    expect(resultView(result()).textContent).toContain(t('result.checkOk'));
    const swapped = resultView(
      result({
        reconciliation: {
          before: 9,
          after: 9,
          mismatches: [
            { key: 'A', name: 'Skin A', before: 4, after: 5 },
            { key: 'B', name: 'Skin B', before: 5, after: 4 },
          ],
        },
      }),
    );
    expect(swapped.textContent).toContain(t('result.checkBad'));
    expect(swapped.textContent).not.toContain(t('result.checkOk'));
    expect(swapped.textContent).toContain(t('result.mismatch', { name: 'Skin A', before: '4', after: '5' }));
    const lost = resultView(result({ reconciliation: { before: 9, after: 8, mismatches: [] } }));
    expect(lost.textContent).toContain(t('result.checkBad'));
  });
});
