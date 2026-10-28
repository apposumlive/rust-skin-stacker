import { describe, expect, it } from 'vitest';
import type { Panel } from '../store';
import type { Inventory, Plan } from '../types';
import { entering, focusPlace, panelStep, showsLoad, swallowsKey, takesFocus, type Shown } from './panel-diff';

const plan = (): Plan => ({ operation: { kind: 'splitAll' }, requests: 4, stacks: 1, queue: [], more: 0, after: [] });
const inventory = (): Inventory => ({ skins: [], unreadable: [] });

function running(p: Plan, patch: Partial<Extract<Panel, { kind: 'running' }>> = {}): Panel {
  return { kind: 'running', plan: p, done: 0, total: p.requests, errors: 0, key: '', processed: [], waitUntil: null, stopping: false, ...patch };
}

function shown(panel: Panel, over: Partial<Shown> = {}): Shown {
  return { panel, selected: [], inventory: inventory(), delay: 1500, loading: false, loadWaitUntil: null, loadStopping: false, ...over };
}

describe('panel step', () => {
  it('builds the first view', () => {
    expect(panelStep(null, shown({ kind: 'selection' }))).toBe('rebuild');
  });

  it('keeps the view when nothing it reads has changed', () => {
    const a = shown({ kind: 'selection' });
    expect(panelStep(a, { ...a })).toBe('keep');
  });

  it('rebuilds a non-running view when anything it reads changes', () => {
    const a = shown({ kind: 'selection' });
    expect(panelStep(a, { ...a, selected: ['x'] })).toBe('rebuild');
    expect(panelStep(a, { ...a, inventory: inventory() })).toBe('rebuild');
    expect(panelStep(a, { ...a, delay: 500 })).toBe('rebuild');
    expect(panelStep(a, { ...a, loading: true })).toBe('rebuild');
    expect(panelStep(a, { ...a, panel: { kind: 'selection' } })).toBe('rebuild');
  });

  it('patches the running view in place on every progress event', () => {
    const p = plan();
    const a = shown(running(p));
    expect(panelStep(a, { ...a, panel: running(p, { done: 1 }) })).toBe('patch');
    expect(panelStep(a, { ...a, panel: running(p, { waitUntil: 123 }) })).toBe('patch');
    expect(panelStep(a, { ...a, panel: running(p, { stopping: true }) })).toBe('patch');
  });

  it('patches the running view when the name source or the pause changes', () => {
    const p = plan();
    const a = shown(running(p));
    expect(panelStep(a, { ...a, inventory: inventory() })).toBe('patch');
    expect(panelStep(a, { ...a, delay: 500 })).toBe('patch');
  });

  it('ignores selection and loading while a run is going', () => {
    const p = plan();
    const panel = running(p);
    const a = shown(panel);
    expect(panelStep(a, { ...a, selected: ['x'] })).toBe('keep');
    expect(panelStep(a, { ...a, loading: true })).toBe('keep');
    expect(panelStep(a, { ...a, selected: ['x', 'y'], loading: true })).toBe('keep');
    // Выбор вместе с шагом запуска — всё равно правка на месте, не пересборка.
    expect(panelStep(a, { ...a, selected: ['x'], panel: running(p, { done: 2 }) })).toBe('patch');
  });

  it('rebuilds when the kind or the plan changes', () => {
    const p = plan();
    const a = shown(running(p));
    expect(panelStep(a, { ...a, panel: running(plan()) })).toBe('rebuild');
    expect(panelStep(a, { ...a, panel: { kind: 'selection' } })).toBe('rebuild');
    expect(panelStep(shown({ kind: 'plan', plan: p, changed: false }), a)).toBe('rebuild');
    expect(
      panelStep(a, {
        ...a,
        panel: { kind: 'result', plan: p, outcome: { reason: 'finished', done: 4, errors: 0, total: 4 }, reconciliation: null, stacks: null },
      }),
    ).toBe('rebuild');
  });

  it('does not let the wait and the stop flag of a read touch the running view', () => {
    const a = shown(running(plan()), { loading: true });
    expect(panelStep(a, { ...a, loadWaitUntil: 123 })).toBe('keep');
    expect(panelStep(a, { ...a, loadStopping: true })).toBe('keep');
  });

  it('does not patch a view that was drawn without an inventory', () => {
    const p = plan();
    const a = shown(running(p), { inventory: null });
    expect(panelStep(a, { ...a, inventory: inventory(), panel: running(p, { done: 1 }) })).toBe('rebuild');
    expect(panelStep(shown(running(p)), { ...a, panel: running(p, { done: 1 }) })).toBe('rebuild');
  });
});

describe('panel step while the inventory is read', () => {
  const sel: Panel = { kind: 'selection' };
  const reading = (over: Partial<Shown> = {}) => shown(sel, { loading: true, ...over });

  it('tells the read without a run from the one inside a run', () => {
    expect(showsLoad({ loading: true, panel: sel })).toBe(true);
    expect(showsLoad({ loading: true, panel: { kind: 'plan', plan: plan(), changed: false } })).toBe(true);
    expect(showsLoad({ loading: false, panel: sel })).toBe(false);
    expect(showsLoad({ loading: true, panel: running(plan()) })).toBe(false);
  });

  it('keeps the load view while the selection, the panel or the inventory change under it', () => {
    const a = reading();
    expect(panelStep(a, { ...a })).toBe('keep');
    expect(panelStep(a, { ...a, selected: ['x'] })).toBe('keep');
    expect(panelStep(a, { ...a, inventory: inventory() })).toBe('keep');
    expect(panelStep(a, { ...a, delay: 500 })).toBe('keep');
    expect(panelStep(a, { ...a, panel: { kind: 'plan', plan: plan(), changed: false } })).toBe('keep');
    // Первое чтение: инвентарь ещё не пришёл, вид тот же.
    const first = reading({ inventory: null });
    expect(panelStep(first, { ...first, selected: ['x'] })).toBe('keep');
  });

  it('patches the load view when the wait or the stop flag changes', () => {
    const a = reading();
    expect(panelStep(a, { ...a, loadWaitUntil: 123 })).toBe('patch');
    expect(panelStep(reading({ loadWaitUntil: 123 }), { ...a, loadWaitUntil: null })).toBe('patch');
    expect(panelStep(a, { ...a, loadStopping: true })).toBe('patch');
    expect(panelStep(a, { ...a, loadWaitUntil: 123, loadStopping: true, selected: ['x'] })).toBe('patch');
  });

  it('rebuilds when the read starts or ends', () => {
    const idle = shown(sel);
    expect(panelStep(idle, { ...idle, loading: true })).toBe('rebuild');
    expect(panelStep(reading(), { ...idle })).toBe('rebuild');
    // Конец чтения приносит и сброс ожидания, но вид всё равно собирается заново.
    expect(panelStep(reading({ loadWaitUntil: 123, loadStopping: true }), { ...idle })).toBe('rebuild');
    const first = reading({ inventory: null });
    expect(panelStep(first, { ...first, loading: false, inventory: inventory() })).toBe('rebuild');
  });

  it('rebuilds when a read starts or ends around a run', () => {
    const p = plan();
    const run = shown(running(p), { loading: true });
    expect(panelStep(reading(), { ...run })).toBe('rebuild');
    expect(panelStep(run, { ...reading() })).toBe('rebuild');
  });
});

describe('panel enter animation', () => {
  it('plays on the first view and when the kind changes', () => {
    const p = plan();
    expect(entering(null, shown({ kind: 'selection' }))).toBe(true);
    expect(entering(shown({ kind: 'selection' }), shown({ kind: 'plan', plan: p, changed: false }))).toBe(true);
    expect(entering(shown({ kind: 'plan', plan: p, changed: false }), shown(running(p)))).toBe(true);
    expect(entering(shown(running(p)), shown({ kind: 'selection' }))).toBe(true);
  });

  it('plays when the inventory arrives into the empty panel', () => {
    const sel: Panel = { kind: 'selection' };
    expect(entering(shown(sel, { inventory: null }), shown(sel))).toBe(true);
  });

  it('plays when the read without a run starts or ends', () => {
    const sel = shown({ kind: 'selection' });
    const reading = { ...sel, loading: true };
    expect(entering(sel, reading)).toBe(true);
    expect(entering(reading, sel)).toBe(true);
    const first = shown({ kind: 'selection' }, { inventory: null, loading: true });
    expect(entering(first, shown({ kind: 'selection' }))).toBe(true);
  });

  it('does not replay while the load view is only updated, or when a read starts inside a run', () => {
    const reading = shown({ kind: 'selection' }, { loading: true });
    expect(entering(reading, { ...reading, loadWaitUntil: 123 })).toBe(false);
    expect(entering(reading, { ...reading, loadStopping: true })).toBe(false);
    const run = shown(running(plan()));
    expect(entering(run, { ...run, loading: true })).toBe(false);
    expect(entering({ ...run, loading: true }, run)).toBe(false);
  });

  it('does not replay while the same kind is only updated', () => {
    const p = plan();
    const a = shown(running(p));
    expect(entering(a, { ...a, panel: running(p, { done: 1 }) })).toBe(false);
    expect(entering(a, { ...a, selected: ['x'] })).toBe(false);
    const sel = shown({ kind: 'selection' });
    expect(entering(sel, { ...sel, selected: ['x'] })).toBe(false);
    expect(entering(sel, { ...sel, inventory: inventory() })).toBe(false);
  });
});

describe('focus after a new view', () => {
  const body = { contains: () => true } as unknown as Element;
  const inside = {} as Element;
  const outside = {} as Element;
  const panel = { contains: (el: Element) => el === inside } as unknown as Element;

  it('moves to the main element when the focus was in the panel or fell to <body>', () => {
    expect(focusPlace(inside, panel, body)).toBe('panel');
    expect(focusPlace(body, panel, body)).toBe('lost');
    expect(focusPlace(null, panel, body)).toBe('lost');
    expect(takesFocus('panel')).toBe(true);
    expect(takesFocus('lost')).toBe(true);
  });

  it('leaves the focus in the grid, the search or the settings alone', () => {
    expect(focusPlace(outside, panel, body)).toBe('elsewhere');
    expect(takesFocus('elsewhere')).toBe(false);
  });
});

describe('held keys in the panel', () => {
  it('swallows auto-repeated Enter and Space, so a held Enter cannot press Run and then Stop', () => {
    expect(swallowsKey('Enter', true)).toBe(true);
    expect(swallowsKey(' ', true)).toBe(true);
  });

  it('lets the first press through', () => {
    expect(swallowsKey('Enter', false)).toBe(false);
    expect(swallowsKey(' ', false)).toBe(false);
  });

  it('lets other keys repeat: arrows move the slider, Tab moves the focus', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'Tab', 'a', 'Spacebar']) expect(swallowsKey(key, true)).toBe(false);
  });
});
