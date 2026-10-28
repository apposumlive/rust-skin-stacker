import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../i18n';
import { defaultFilter } from '../model';
import type { Panel, State } from '../store';
import type { Inventory } from '../types';
import { byClass, FakeEl, fakeDocument } from './fake-dom';
import { createTopbar } from './topbar';

const inventory: Inventory = { skins: [], unreadable: [] };

function stateOf(over: Partial<State> = {}): State {
  return {
    screen: 'main',
    lang: 'en',
    settings: { language: null, delayMs: 1500, uiScale: 100 },
    token: null,
    inventory,
    loading: false,
    loadWaitUntil: null,
    loadStopping: false,
    error: null,
    tokenExpired: false,
    filter: defaultFilter(),
    selected: [],
    anchor: null,
    panel: { kind: 'selection' },
    menuOpen: false,
    settingsOpen: false,
    ...over,
  };
}

const running: Panel = {
  kind: 'running',
  plan: { operation: { kind: 'splitAll' }, requests: 4, stacks: 1, queue: [], more: 0, after: [] },
  done: 0,
  total: 4,
  errors: 0,
  key: '',
  processed: [],
  waitUntil: null,
  stopping: false,
};

beforeEach(() => {
  setLang('en');
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', { setInterval: vi.fn(), clearInterval: vi.fn(), setTimeout: vi.fn(), clearTimeout: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bulk buttons: which one is lit', () => {
  const split: Panel = {
    kind: 'plan',
    plan: { operation: { kind: 'splitAll' }, requests: 4, stacks: 1, queue: [], more: 0, after: [] },
    changed: false,
  };

  function lit(state: State): Array<[boolean, string | null]> {
    const el = new FakeEl('header');
    createTopbar(el as unknown as HTMLElement).update(state);
    return byClass(el, 'bulk').map((button) => [button.classes.has('active'), button.getAttribute('aria-pressed')]);
  }

  it('lights the button of the open plan', () => {
    expect(lit(stateOf({ panel: split }))).toEqual([[true, 'true'], [false, 'false']]);
  });

  it('lights nothing while the inventory is read: the plan is not visible under the load view', () => {
    expect(lit(stateOf({ panel: split, loading: true }))).toEqual([[false, 'false'], [false, 'false']]);
  });

  it('lights nothing without a plan', () => {
    expect(lit(stateOf())).toEqual([[false, 'false'], [false, 'false']]);
  });
});

describe('bulk buttons', () => {
  function bulk(state: State): boolean[] {
    const el = new FakeEl('header');
    createTopbar(el as unknown as HTMLElement).update(state);
    return byClass(el, 'bulk').map((button) => button.disabled);
  }

  it('are enabled when the inventory is there and nothing runs or loads', () => {
    expect(bulk(stateOf())).toEqual([false, false]);
  });

  it('are disabled without an inventory, during a run and while the inventory is read', () => {
    expect(bulk(stateOf({ inventory: null }))).toEqual([true, true]);
    expect(bulk(stateOf({ panel: running }))).toEqual([true, true]);
    expect(bulk(stateOf({ loading: true }))).toEqual([true, true]);
    expect(bulk(stateOf({ loading: true, inventory: null }))).toEqual([true, true]);
  });
});
