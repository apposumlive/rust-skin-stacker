import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang, t } from '../i18n';
import type { Panel, State } from '../store';
import type { Inventory, InvRecord, Plan, Skin } from '../types';
import { byClass, byTag, FakeEl, fakeDocument } from './fake-dom';
import { patchRunning, planView, runningView } from './panel-run';

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
