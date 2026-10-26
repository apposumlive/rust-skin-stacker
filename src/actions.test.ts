import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetToken, loadInventory, runPlan, saveSettings, showPlan, stopRun, switchLang } from './actions';
import { useApi, type Api } from './api';
import { setLang } from './i18n';
import { getState, initState, initialFilter, setState, type Panel, type State } from './store';
import type { Inventory, InvRecord, Plan, Progress, RunOutcome, Settings, Skin, StartResult } from './types';

function rec(assetid: string, amount: number): InvRecord {
  return { assetid, classid: 'c1', instanceid: '0', amount, tradable: true, marketable: true, availableAfter: null };
}

function skin(key: string, amount = 3): Skin {
  return { key, name: key, icon: null, category: null, total: amount, records: [rec(`${key}-1`, amount)] };
}

const inv = (...keys: string[]): Inventory => ({ skins: keys.map((k) => skin(k)), unreadable: [] });

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
    expect(s.panel).toEqual({ kind: 'result', plan, outcome: outcome(), reconciliation: null });
    expect(s.inventory).toBe(before);
    expect(s.tokenExpired).toBe(false);
  });

  it('passes the reconciliation of the core to the result', async () => {
    const reconciliation = { before: 9, after: 9, mismatches: [{ key: 'A', name: 'A', before: 4, after: 5 }] };
    useApi(fakeApi({ start: async () => ({ kind: 'finished', outcome: outcome(), reconciliation, inventory: null }) }));
    await runPlan(plan);
    expect(getState().panel).toEqual({ kind: 'result', plan, outcome: outcome(), reconciliation });
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
