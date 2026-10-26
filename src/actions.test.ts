import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adoptInventory, forgetToken, loadInventory, runPlan, saveSettings, showPlan, signIn, stopRun, switchLang } from './actions';
import { useApi, type Api } from './api';
import { setLang } from './i18n';
import { visibleSkins } from './model';
import { getState, initState, initialFilter, setState, type Panel, type State } from './store';
import type { Inventory, InvRecord, Plan, Progress, RunOutcome, Settings, Skin, StartResult } from './types';

function rec(assetid: string, amount: number): InvRecord {
  return { assetid, classid: 'c1', instanceid: '0', amount, tradable: true, marketable: true, availableAfter: null };
}

function skin(key: string, amount = 3): Skin {
  return { key, name: key, icon: null, category: null, total: amount, records: [rec(`${key}-1`, amount)] };
}

const inv = (...keys: string[]): Inventory => ({ skins: keys.map((k) => skin(k)), unreadable: [] });

/** Инвентарь, где всё лежит по одному: таким он становится после «Разделить всё». */
const singles = (...keys: string[]): Inventory => ({ skins: keys.map((k) => skin(k, 1)), unreadable: [] });

/** Инвентарь из пар «предмет — тип»: у каждого предмета тип с этим id. */
const invIn = (...pairs: Array<[key: string, category: string]>): Inventory => ({
  skins: pairs.map(([key, id]) => ({ ...skin(key), category: { id, label: id } })),
  unreadable: [],
});

const plan: Plan = { operation: { kind: 'splitAll' }, requests: 4, stacks: 1, queue: [], more: 0, after: [] };
const newPlan: Plan = { ...plan, requests: 2 };
const outcome = (reason: RunOutcome['reason'] = 'finished'): RunOutcome => ({ reason, done: 4, errors: 0, total: 4 });
const settings: Settings = { language: null, delayMs: 1500 };

const finished = (reason: RunOutcome['reason'] = 'finished', inventory: Inventory | null = null): StartResult => ({
  kind: 'finished',
  outcome: outcome(reason),
  reconciliation: null,
  inventory,
});

/** Промис, который закрывает тест: так можно удержать ответ ядра и ответить позже. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Ядро без побочных эффектов; тест подменяет только то, что проверяет. */
function fakeApi(over: Partial<Api> = {}): Api {
  return {
    setToken: async () => ({ steamidMasked: '7656…0001', expiresAt: 2_000_000_000 }),
    forgetToken: async () => {},
    loadInventory: async () => inv('A'),
    preview: async () => plan,
    start: async () => finished(),
    stop: async () => {},
    getSettings: async () => settings,
    saveSettings: async (next) => next,
    journal: async () => '',
    onProgress: async () => () => {},
    openTokenPage: async () => {},
    ...over,
  };
}

function freshState(over: Partial<State> = {}): void {
  initState({
    screen: 'main',
    lang: 'en',
    settings,
    token: { steamidMasked: '7656…0001', expiresAt: 2_000_000_000 },
    inventory: inv('A', 'B'),
    loading: false,
    error: null,
    tokenExpired: false,
    filter: initialFilter,
    selected: [],
    anchor: null,
    panel: { kind: 'selection' },
    menuOpen: false,
    settingsOpen: false,
    ...over,
  });
}

function running(): Extract<Panel, { kind: 'running' }> {
  const panel = getState().panel;
  if (panel.kind !== 'running') throw new Error(`panel is ${panel.kind}`);
  return panel;
}

beforeEach(() => {
  setLang('en');
  freshState();
  useApi(fakeApi());
});

describe('runPlan', () => {
  it('shows the new plan with changed:true and no result when the plan changed', async () => {
    const fresh = inv('A', 'C');
    useApi(fakeApi({ start: async () => ({ kind: 'planChanged', plan: newPlan, inventory: fresh }) }));
    await runPlan(plan);
    const s = getState();
    expect(s.panel).toEqual({ kind: 'plan', plan: newPlan, changed: true });
    expect(s.inventory).toBe(fresh);
    expect(s.error).toBeNull();
    expect(s.tokenExpired).toBe(false);
  });

  it('shows the result with reconciliation null and the old inventory when the core sends none', async () => {
    const before = getState().inventory;
    await runPlan(plan);
    const s = getState();
    expect(s.panel).toEqual({ kind: 'result', plan, outcome: outcome(), reconciliation: null, stacks: null });
    expect(s.inventory).toBe(before);
    expect(s.tokenExpired).toBe(false);
  });

  it('passes the reconciliation of the core to the result', async () => {
    const reconciliation = { before: 9, after: 9, mismatches: [{ key: 'A', name: 'A', before: 4, after: 5 }] };
    useApi(fakeApi({ start: async () => ({ kind: 'finished', outcome: outcome(), reconciliation, inventory: null }) }));
    await runPlan(plan);
    expect(getState().panel).toEqual({ kind: 'result', plan, outcome: outcome(), reconciliation, stacks: null });
  });

  it('takes the fresh inventory from the result', async () => {
    const fresh = inv('A', 'B', 'C');
    useApi(fakeApi({ start: async () => finished('finished', fresh) }));
    await runPlan(plan);
    expect(getState().inventory).toBe(fresh);
  });

  it('marks the token expired when the core stopped on tokenRejected', async () => {
    useApi(fakeApi({ start: async () => finished('tokenRejected') }));
    await runPlan(plan);
    const s = getState();
    expect(s.panel.kind).toBe('result');
    expect(s.tokenExpired).toBe(true);
  });

  it('returns to the selection with an error when start fails with busy', async () => {
    useApi(fakeApi({ start: () => Promise.reject({ code: 'busy' }) }));
    await runPlan(plan);
    const s = getState();
    expect(s.panel).toEqual({ kind: 'selection' });
    expect(s.error).toEqual({ code: 'busy', status: null });
    expect(s.tokenExpired).toBe(false);
  });

  it('turns a token error from start into the expired-token banner', async () => {
    useApi(fakeApi({ start: () => Promise.reject({ code: 'tokenRejected' }) }));
    await runPlan(plan);
    const s = getState();
    expect(s.panel).toEqual({ kind: 'selection' });
    expect(s.tokenExpired).toBe(true);
    expect(s.error).toBeNull();
  });

  it('does not start a second run while one is going', async () => {
    const start = vi.fn(() => new Promise<StartResult>(() => {}));
    useApi(fakeApi({ start }));
    void runPlan(plan);
    await tick();
    await runPlan(plan);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('follows the progress of the core and ignores events after the run', async () => {
    let emit: (p: Progress) => void = () => {};
    const run = deferred<StartResult>();
    useApi(
      fakeApi({
        onProgress: async (cb) => {
          emit = cb;
          return () => {};
        },
        start: () => run.promise,
      }),
    );
    const done = runPlan(plan);
    await tick();
    emit({ kind: 'request', done: 2, total: 4, errors: 1, key: 'A' });
    expect(running()).toMatchObject({ done: 2, total: 4, errors: 1, key: 'A', waitUntil: null });
    const before = Date.now();
    emit({ kind: 'waiting', seconds: 10 });
    expect(running().waitUntil).toBeGreaterThanOrEqual(before + 10_000);
    run.resolve(finished());
    await done;
    emit({ kind: 'request', done: 3, total: 4, errors: 0, key: 'B' });
    expect(getState().panel.kind).toBe('result');
  });

  describe('progress listener', () => {
    function listening(over: Partial<Api> = {}) {
      const unlisten = vi.fn();
      useApi(fakeApi({ onProgress: async () => unlisten, ...over }));
      return unlisten;
    }

    it('is released after a finished run', async () => {
      const unlisten = listening();
      await runPlan(plan);
      expect(unlisten).toHaveBeenCalledTimes(1);
    });

    it('is released when the plan changed', async () => {
      const unlisten = listening({ start: async () => ({ kind: 'planChanged', plan: newPlan, inventory: inv('A') }) });
      await runPlan(plan);
      expect(unlisten).toHaveBeenCalledTimes(1);
    });

    it('is released when start fails', async () => {
      const unlisten = listening({ start: () => Promise.reject({ code: 'network' }) });
      await runPlan(plan);
      expect(unlisten).toHaveBeenCalledTimes(1);
    });

    it('leaves the selection with an error when the subscription fails', async () => {
      const start = vi.fn(async () => finished());
      listening({ onProgress: () => Promise.reject({ code: 'unknown' }), start });
      await runPlan(plan);
      const s = getState();
      expect(s.panel).toEqual({ kind: 'selection' });
      expect(s.error).toEqual({ code: 'unknown', status: null });
      expect(start).not.toHaveBeenCalled();
    });
  });
});

describe('stopRun', () => {
  function startRun(over: Partial<Api> = {}) {
    useApi(fakeApi({ start: () => new Promise<StartResult>(() => {}), ...over }));
    void runPlan(plan);
    return tick();
  }

  it('asks the core to stop only once', async () => {
    const stop = vi.fn(async () => {});
    await startRun({ stop });
    stopRun();
    stopRun();
    await tick();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(running().stopping).toBe(true);
  });

  it('does nothing when no run is going', () => {
    const stop = vi.fn(async () => {});
    useApi(fakeApi({ stop }));
    stopRun();
    expect(stop).not.toHaveBeenCalled();
    expect(getState().panel).toEqual({ kind: 'selection' });
  });

  it('lets the user press stop again and shows the error when the core fails', async () => {
    const stop = vi.fn(() => Promise.reject({ code: 'unknown' }));
    await startRun({ stop });
    stopRun();
    await tick();
    expect(running().stopping).toBe(false);
    expect(getState().error).toEqual({ code: 'unknown', status: null });
    stopRun();
    expect(stop).toHaveBeenCalledTimes(2);
  });
});

describe('a result that arrives after «Forget token»', () => {
  const login = {
    screen: 'login',
    token: null,
    inventory: null,
    loading: false,
    selected: [],
    panel: { kind: 'selection' },
    tokenExpired: false,
    error: null,
  };

  it('does not reach the new session from runPlan', async () => {
    const run = deferred<StartResult>();
    const unlisten = vi.fn();
    useApi(fakeApi({ start: () => run.promise, onProgress: async () => unlisten }));
    const done = runPlan(plan);
    await tick();
    await forgetToken();
    run.resolve(finished('tokenRejected', inv('Z')));
    await done;
    expect(getState()).toMatchObject(login);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('does not reach the new session from a runPlan that fails', async () => {
    const run = deferred<StartResult>();
    useApi(fakeApi({ start: () => run.promise }));
    const done = runPlan(plan);
    await tick();
    await forgetToken();
    run.reject({ code: 'tokenRejected' });
    await done;
    expect(getState()).toMatchObject(login);
  });

  it('does not start the run when the token was forgotten while subscribing', async () => {
    const subscribed = deferred<() => void>();
    const start = vi.fn(async () => finished());
    const unlisten = vi.fn();
    useApi(fakeApi({ onProgress: () => subscribed.promise, start }));
    const done = runPlan(plan);
    await forgetToken();
    subscribed.resolve(unlisten);
    await done;
    expect(start).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(getState()).toMatchObject(login);
  });

  it('does not let the old run drive the progress of a run in the new session', async () => {
    const listeners: Array<(p: Progress) => void> = [];
    useApi(
      fakeApi({
        onProgress: async (cb) => {
          listeners.push(cb);
          return () => {};
        },
        start: () => new Promise<StartResult>(() => {}),
      }),
    );
    void runPlan(plan);
    await tick();
    await forgetToken();
    setState({ screen: 'main' });
    void runPlan(newPlan);
    await tick();
    listeners[0]?.({ kind: 'request', done: 3, total: 4, errors: 2, key: 'old' });
    expect(running()).toMatchObject({ done: 0, total: 2, errors: 0, key: '' });
    listeners[1]?.({ kind: 'request', done: 1, total: 2, errors: 0, key: 'new' });
    expect(running()).toMatchObject({ done: 1, total: 2, key: 'new' });
  });

  it('does not reach the new session from loadInventory', async () => {
    const read = deferred<Inventory>();
    useApi(fakeApi({ loadInventory: () => read.promise }));
    const done = loadInventory();
    expect(getState().loading).toBe(true);
    await forgetToken();
    read.resolve(inv('Z'));
    await done;
    expect(getState()).toMatchObject(login);
  });

  it('does not reach the new session from a loadInventory that fails', async () => {
    const read = deferred<Inventory>();
    useApi(fakeApi({ loadInventory: () => read.promise }));
    const done = loadInventory();
    await forgetToken();
    read.reject({ code: 'tokenRejected' });
    await done;
    expect(getState()).toMatchObject(login);
  });

  it('does not reach the new session from showPlan', async () => {
    const preview = deferred<Plan>();
    useApi(fakeApi({ preview: () => preview.promise }));
    const done = showPlan({ kind: 'splitAll' });
    await forgetToken();
    preview.resolve(plan);
    await done;
    expect(getState()).toMatchObject(login);
  });

  it('does not reach the new session from a showPlan that fails', async () => {
    const preview = deferred<Plan>();
    useApi(fakeApi({ preview: () => preview.promise }));
    const done = showPlan({ kind: 'splitAll' });
    await forgetToken();
    preview.reject({ code: 'tokenRejected' });
    await done;
    expect(getState()).toMatchObject(login);
  });

  it('does not show the failure of an old stop in the new session', async () => {
    const stop = deferred<void>();
    useApi(fakeApi({ stop: () => stop.promise, start: () => new Promise<StartResult>(() => {}) }));
    void runPlan(plan);
    await tick();
    stopRun();
    await forgetToken();
    stop.reject({ code: 'unknown' });
    await tick();
    expect(getState()).toMatchObject(login);
  });

  it('still shows results of the same session', async () => {
    const fresh = inv('Z');
    useApi(fakeApi({ loadInventory: async () => fresh }));
    await forgetToken();
    setState({ screen: 'main' });
    await loadInventory();
    expect(getState().inventory).toBe(fresh);
  });
});

describe('forgetToken', () => {
  it('resets the window to the login screen', async () => {
    setState({ selected: ['A'], anchor: 'A', tokenExpired: true, error: { code: 'network', status: null }, menuOpen: true, settingsOpen: true });
    await forgetToken();
    expect(getState()).toMatchObject({
      screen: 'login',
      token: null,
      inventory: null,
      loading: false,
      selected: [],
      anchor: null,
      panel: { kind: 'selection' },
      tokenExpired: false,
      error: null,
      menuOpen: false,
      settingsOpen: false,
    });
  });

  it('resets the window and keeps the error when the core fails', async () => {
    useApi(fakeApi({ forgetToken: () => Promise.reject({ code: 'unknown' }) }));
    await expect(forgetToken()).resolves.toBeUndefined();
    expect(getState()).toMatchObject({ screen: 'login', token: null, inventory: null, error: { code: 'unknown', status: null } });
  });
});

describe('loadInventory', () => {
  it('keeps only the selected skins that are still in the inventory', async () => {
    setState({ selected: ['A', 'B', 'GONE'], anchor: 'B' });
    useApi(fakeApi({ loadInventory: async () => inv('A', 'C') }));
    await loadInventory();
    const s = getState();
    expect(s.selected).toEqual(['A']);
    expect(s.loading).toBe(false);
    expect(s.panel).toEqual({ kind: 'selection' });
  });

  describe('type filter', () => {
    it('drops the checked types that are no longer in the inventory and keeps the rest of the filter', async () => {
      setState({ filter: { search: 'a', show: 'stacks', categories: ['Tool', 'Weapon'], sort: 'name' } });
      useApi(fakeApi({ loadInventory: async () => invIn(['A', 'Weapon'], ['B', 'Outfit']) }));
      await loadInventory();
      expect(getState().filter).toEqual({ search: 'a', show: 'stacks', categories: ['Weapon'], sort: 'name' });
    });

    it('does not leave an empty grid behind a checkbox nobody can clear after switching accounts', async () => {
      setState({ inventory: invIn(['A', 'Tool']), filter: { ...initialFilter, categories: ['Tool'] } });
      await forgetToken();
      setState({ screen: 'main' });
      const other = invIn(['B', 'Weapon'], ['C', 'Outfit']);
      useApi(fakeApi({ loadInventory: async () => other }));
      await loadInventory();
      const s = getState();
      expect(s.filter.categories).toEqual([]);
      expect(visibleSkins(other, s.filter).map((k) => k.key)).toEqual(['B', 'C']);
    });

    it('clears the types when the inventory has none at all', async () => {
      setState({ filter: { ...initialFilter, categories: ['Tool'] } });
      useApi(fakeApi({ loadInventory: async () => inv('A') }));
      await loadInventory();
      expect(getState().filter.categories).toEqual([]);
    });

    it('keeps the same filter object when every checked type is still there', async () => {
      const filter = { ...initialFilter, categories: ['Weapon'] };
      setState({ filter });
      useApi(fakeApi({ loadInventory: async () => invIn(['A', 'Weapon'], ['B', 'Outfit']) }));
      await loadInventory();
      expect(getState().filter).toBe(filter);
    });

    it('keeps the same filter object when no type is checked', async () => {
      const filter = getState().filter;
      useApi(fakeApi({ loadInventory: async () => invIn(['A', 'Weapon']) }));
      await loadInventory();
      expect(getState().filter).toBe(filter);
    });

    it('leaves the filter alone when the read fails', async () => {
      const filter = { ...initialFilter, categories: ['Tool'] };
      setState({ filter });
      useApi(fakeApi({ loadInventory: () => Promise.reject({ code: 'http', status: 502 }) }));
      await loadInventory();
      expect(getState().filter).toBe(filter);
    });
  });

  it('puts the selection panel back after a reload', async () => {
    setState({ panel: { kind: 'plan', plan, changed: false } });
    await loadInventory();
    expect(getState().panel).toEqual({ kind: 'selection' });
  });

  it('keeps the running panel', async () => {
    useApi(fakeApi({ start: () => new Promise<StartResult>(() => {}) }));
    void runPlan(plan);
    await tick();
    const panel = getState().panel;
    await loadInventory();
    expect(getState().panel).toBe(panel);
    expect(getState().inventory?.skins.map((s) => s.key)).toEqual(['A']);
  });

  it('shows the error and stops loading when the read fails', async () => {
    useApi(fakeApi({ loadInventory: () => Promise.reject({ code: 'http', status: 502 }) }));
    await loadInventory();
    const s = getState();
    expect(s.loading).toBe(false);
    expect(s.error).toEqual({ code: 'http', status: 502 });
    expect(s.tokenExpired).toBe(false);
  });

  it('turns a token error into the expired-token banner', async () => {
    useApi(fakeApi({ loadInventory: () => Promise.reject({ code: 'tokenExpired' }) }));
    await loadInventory();
    const s = getState();
    expect(s.tokenExpired).toBe(true);
    expect(s.error).toBeNull();
  });
});

describe('switchLang and saveSettings', () => {
  const saveFails = () => Promise.reject({ code: 'settingsNotSaved' });

  it('switches the language and saves it', async () => {
    const save = vi.fn(async (next: Settings) => next);
    useApi(fakeApi({ saveSettings: save }));
    await expect(switchLang('ru')).resolves.toBeNull();
    expect(save).toHaveBeenCalledWith({ language: 'ru', delayMs: 1500 });
    expect(getState().lang).toBe('ru');
    expect(getState().settings.language).toBe('ru');
  });

  it('keeps the language and shows the error on the main screen when saving fails', async () => {
    useApi(fakeApi({ saveSettings: saveFails }));
    await expect(switchLang('ru')).resolves.toEqual({ code: 'settingsNotSaved', status: null });
    const s = getState();
    expect(s.lang).toBe('en');
    expect(s.settings).toBe(settings);
    expect(s.error).toEqual({ code: 'settingsNotSaved', status: null });
  });

  it('returns the error and leaves the state alone on the login screen', async () => {
    freshState({ screen: 'login', token: null, inventory: null });
    useApi(fakeApi({ saveSettings: saveFails }));
    await expect(switchLang('ru')).resolves.toEqual({ code: 'settingsNotSaved', status: null });
    expect(getState().lang).toBe('en');
    expect(getState().error).toBeNull();
  });

  it('saveSettings still rejects for its callers', async () => {
    useApi(fakeApi({ saveSettings: saveFails }));
    await expect(saveSettings({ language: 'ru', delayMs: 1500 })).rejects.toEqual({ code: 'settingsNotSaved' });
    expect(getState().lang).toBe('en');
  });
});

describe('adoptInventory', () => {
  it('switches «Stacks» to «All» after a run that left no stacks, so the grid does not look empty', async () => {
    setState({ filter: { ...initialFilter, show: 'stacks' } });
    useApi(fakeApi({ start: async () => finished('finished', singles('A', 'B')) }));
    await runPlan(plan);
    const s = getState();
    expect(s.filter.show).toBe('all');
    expect(visibleSkins(s.inventory!, s.filter).map((k) => k.key)).toEqual(['A', 'B']);
  });

  it('does the same when the plan changed', async () => {
    setState({ filter: { ...initialFilter, show: 'stacks' } });
    useApi(fakeApi({ start: async () => ({ kind: 'planChanged', plan: newPlan, inventory: singles('A') }) }));
    await runPlan(plan);
    expect(getState().filter.show).toBe('all');
  });

  it('does the same on a reload', async () => {
    setState({ filter: { ...initialFilter, show: 'dupes' } });
    useApi(fakeApi({ loadInventory: async () => singles('A') }));
    await loadInventory();
    expect(getState().filter.show).toBe('all');
  });

  it('keeps «Stacks» and the same filter object while there are stacks', async () => {
    const filter = { ...initialFilter, show: 'stacks' as const };
    setState({ filter });
    useApi(fakeApi({ start: async () => finished('finished', inv('A')) }));
    await runPlan(plan);
    expect(getState().filter).toBe(filter);
  });

  it('keeps «Stacks» when the inventory itself is empty', () => {
    setState({ filter: { ...initialFilter, show: 'stacks' } });
    expect(adoptInventory({ skins: [], unreadable: [] }).filter.show).toBe('stacks');
  });

  it('drops the selected keys and the anchor that vanished after a run', async () => {
    setState({ selected: ['A', 'B'], anchor: 'B' });
    useApi(fakeApi({ start: async () => finished('finished', inv('A')) }));
    await runPlan(plan);
    expect(getState()).toMatchObject({ selected: ['A'], anchor: null });
  });

  it('keeps the same selection array and the anchor when nothing vanished', () => {
    const selected = ['A'];
    setState({ selected, anchor: 'A' });
    const next = adoptInventory(inv('A', 'C'));
    expect(next.selected).toBe(selected);
    expect(next.anchor).toBe('A');
  });

  it('leaves the selection alone when the core sends no inventory after the run', async () => {
    setState({ selected: ['B'], anchor: 'B' });
    await runPlan(plan);
    expect(getState()).toMatchObject({ selected: ['B'], anchor: 'B' });
  });

  it('counts the stacks of the fresh inventory for the result, and none without it', async () => {
    useApi(fakeApi({ start: async () => finished('finished', { skins: [skin('A', 3), skin('B', 1)], unreadable: [] }) }));
    await runPlan(plan);
    expect(getState().panel).toMatchObject({ kind: 'result', stacks: 1 });
    useApi(fakeApi({ start: async () => finished('finished', null) }));
    await runPlan(plan);
    expect(getState().panel).toMatchObject({ kind: 'result', stacks: null });
  });
});

describe('Stop pressed before the run reached the core', () => {
  let emit: (p: Progress) => void = () => {};
  const event = (done: number): Progress => ({ kind: 'request', done, total: 4, errors: 0, key: 'A' });

  async function startRun(stop: Api['stop']) {
    useApi(
      fakeApi({
        stop,
        start: () => new Promise<StartResult>(() => {}),
        onProgress: async (cb) => {
          emit = cb;
          return () => {};
        },
      }),
    );
    void runPlan(plan);
    await tick();
  }

  it('is asked once more on the first progress event, because the start of the run wiped it', async () => {
    const stop = vi.fn(async () => {});
    await startRun(stop);
    stopRun();
    expect(stop).toHaveBeenCalledTimes(1);
    emit(event(0));
    expect(stop).toHaveBeenCalledTimes(2);
    emit(event(1));
    await tick();
    expect(stop).toHaveBeenCalledTimes(2);
    expect(running().stopping).toBe(true);
  });

  it('is not asked again when Stop was pressed after the run started', async () => {
    const stop = vi.fn(async () => {});
    await startRun(stop);
    emit(event(0));
    stopRun();
    emit(event(1));
    await tick();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('is not asked at all when nobody pressed Stop', async () => {
    const stop = vi.fn(async () => {});
    await startRun(stop);
    emit(event(0));
    await tick();
    expect(stop).not.toHaveBeenCalled();
  });

  it('lets the user press Stop again when the repeated request fails', async () => {
    const stop = vi.fn<Api['stop']>().mockResolvedValueOnce().mockRejectedValueOnce({ code: 'unknown' });
    await startRun(stop);
    stopRun();
    emit(event(0));
    await tick();
    expect(running().stopping).toBe(false);
    expect(getState().error).toEqual({ code: 'unknown', status: null });
  });
});

describe('language change', () => {
  it('re-reads the inventory in the new language and keeps the open view', async () => {
    const load = vi.fn(async () => inv('A', 'B'));
    useApi(fakeApi({ loadInventory: load }));
    setState({ panel: { kind: 'plan', plan, changed: false } });
    await saveSettings({ language: 'ru', delayMs: 1500 });
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('ru');
    expect(getState().panel).toEqual({ kind: 'plan', plan, changed: false });
  });

  it('does not re-read when only the pause changed', async () => {
    const load = vi.fn(async () => inv('A'));
    useApi(fakeApi({ loadInventory: load }));
    await saveSettings({ language: 'en', delayMs: 3000 });
    await tick();
    expect(load).not.toHaveBeenCalled();
  });

  it('does not read on the login screen', async () => {
    freshState({ screen: 'login', token: null, inventory: null });
    const load = vi.fn(async () => inv('A'));
    useApi(fakeApi({ loadInventory: load }));
    await switchLang('ru');
    await tick();
    expect(load).not.toHaveBeenCalled();
  });

  it('waits for the result of a run and keeps the result view', async () => {
    const run = deferred<StartResult>();
    const load = vi.fn(async () => inv('A', 'B'));
    useApi(fakeApi({ start: () => run.promise, loadInventory: load }));
    const done = runPlan(plan);
    await tick();
    await switchLang('ru');
    await tick();
    expect(load).not.toHaveBeenCalled();
    run.resolve(finished('finished', inv('A')));
    await done;
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('ru');
    expect(getState().panel.kind).toBe('result');
  });

  it('forgets the pending re-read with the token', async () => {
    const run = deferred<StartResult>();
    const load = vi.fn(async () => inv('A'));
    useApi(fakeApi({ start: () => run.promise, loadInventory: load }));
    const done = runPlan(plan);
    await tick();
    await switchLang('ru');
    await forgetToken();
    run.resolve(finished());
    await done;
    signIn({ steamidMasked: '7656…0001', expiresAt: 2_000_000_000 });
    useApi(fakeApi({ start: async () => finished(), loadInventory: load }));
    setState({ inventory: inv('A') });
    await runPlan(plan);
    await tick();
    expect(load).not.toHaveBeenCalled();
  });
});

describe('signIn', () => {
  const token = { steamidMasked: '7656…0001', expiresAt: 2_000_000_000 };

  beforeEach(() => {
    freshState({ screen: 'login', token: null, inventory: null });
  });

  it('opens the main screen with a clean state', () => {
    setState({ tokenExpired: true, error: { code: 'network', status: null } });
    signIn(token);
    expect(getState()).toMatchObject({ screen: 'main', token, inventory: null, loading: false, tokenExpired: false, error: null });
  });

  it('drops a stale noToken from a read the core cut off when the new token came', async () => {
    const read = deferred<Inventory>();
    useApi(fakeApi({ loadInventory: () => read.promise }));
    const done = loadInventory();
    signIn(token);
    read.reject({ code: 'noToken' });
    await done;
    expect(getState()).toMatchObject({ screen: 'main', tokenExpired: false, error: null, loading: false, inventory: null });
  });

  it('drops a stale inventory of the old token', async () => {
    const read = deferred<Inventory>();
    useApi(fakeApi({ loadInventory: () => read.promise }));
    const done = loadInventory();
    signIn(token);
    read.resolve(inv('OLD'));
    await done;
    expect(getState().inventory).toBeNull();
  });

  it('applies a read started after it', async () => {
    const fresh = inv('NEW');
    useApi(fakeApi({ loadInventory: async () => fresh }));
    signIn(token);
    await loadInventory();
    expect(getState().inventory).toBe(fresh);
  });
});
