import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApi, type Api } from '../api';
import { fmtInt } from '../format';
import { setLang, t } from '../i18n';
import { defaultFilter } from '../model';
import { getState, initState, type State } from '../store';
import { byClass, byTag, FakeEl, fakeDocument, findAll, fire } from './fake-dom';
import { loadingView, patchLoading } from './panel-load';

const NOW = 1_700_000_000_000;

function stateOf(over: Partial<State> = {}): State {
  return {
    screen: 'main',
    lang: 'en',
    settings: { language: null, delayMs: 1500, uiScale: 100 },
    token: null,
    inventory: null,
    loading: true,
    loadWaitUntil: null,
    loadProgress: null,
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

/** Главный элемент вида: на него панель переводит фокус после смены вида. */
const mains = (root: unknown) => findAll(root, (el) => el.attrs.has('data-main'));
/** Строка «Записей прочитано»: `p.num`, но не строка ожидания. */
const progressLine = (root: unknown) => {
  const [line] = findAll(root, (el) => el.tag === 'p' && el.classes.has('num') && !el.classes.has('wait'));
  return line;
};
/** Кнопки в закреплённом снизу блоке. */
const docked = (root: unknown) => byClass(root, 'dock').flatMap((dock) => byTag(dock, 'button'));

beforeEach(() => {
  setLang('en');
  vi.stubGlobal('document', fakeDocument);
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('load view', () => {
  it('has the heading as the main element and Stop docked below, active', () => {
    const el = loadingView(stateOf(), vi.fn());
    expect(el.classList.contains('panel')).toBe(true);
    expect(el.classList.contains('load-view')).toBe(true);
    const [main] = mains(el);
    expect(mains(el)).toHaveLength(1);
    expect(main.tag).toBe('h2');
    expect(main.textContent).toBe(t('grid.loading'));
    expect(main.getAttribute('tabindex')).toBe('-1');
    const [stop] = docked(el);
    expect(docked(el)).toHaveLength(1);
    expect(stop.textContent).toBe(t('run.stop'));
    expect(stop.disabled).toBe(false);
    expect(stop.classes.has('danger')).toBe(true);
    expect(stop.getAttribute('type')).toBe('button');
  });

  it('hides the wait line until Steam asks to wait, and announces it as a status', () => {
    const el = loadingView(stateOf(), vi.fn());
    const wait = byClass(el, 'wait')[0];
    expect(wait.hidden).toBe(true);
    expect(wait.textContent).toBe('');
    expect(wait.getAttribute('role')).toBe('status');
  });

  it('counts the 429 wait down once a second and hides the line at zero', () => {
    const tick = vi.fn();
    const el = loadingView(stateOf({ loadWaitUntil: NOW + 29_001 }), tick);
    const wait = byClass(el, 'wait')[0];
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
  });

  it('shows an already expired wait as hidden and does not start a timer without a wait', () => {
    const tick = vi.fn();
    const el = loadingView(stateOf({ loadWaitUntil: NOW - 500 }), tick);
    expect(byClass(el, 'wait')[0].hidden).toBe(true);
    const idle = vi.fn();
    loadingView(stateOf(), idle);
    expect(idle).not.toHaveBeenCalled();
  });

  it('keeps its nodes while it is patched, so Stop keeps focus and the click', () => {
    const tick = vi.fn();
    const el = loadingView(stateOf(), tick);
    const [stop] = docked(el);
    const [heading] = mains(el);
    const wait = byClass(el, 'wait')[0];

    expect(patchLoading(el, stateOf({ loadWaitUntil: NOW + 5_000 }), tick)).toBe(true);
    expect(wait.hidden).toBe(false);
    expect(wait.textContent).toBe(t('run.waiting', { seconds: '5' }));
    expect(tick).toHaveBeenCalledTimes(1);

    expect(patchLoading(el, stateOf({ loadWaitUntil: null }), tick)).toBe(true);
    expect(wait.hidden).toBe(true);
    expect(wait.textContent).toBe('');

    expect(patchLoading(el, stateOf({ loadStopping: true }), tick)).toBe(true);
    expect(docked(el)).toHaveLength(1);
    expect(docked(el)[0]).toBe(stop);
    expect(mains(el)[0]).toBe(heading);
    expect(byClass(el, 'wait')[0]).toBe(wait);
  });

  it('turns Stop into a disabled «Stopping…» once it is pressed', () => {
    const tick = vi.fn();
    const el = loadingView(stateOf(), tick);
    const [stop] = docked(el);
    patchLoading(el, stateOf({ loadStopping: true }), tick);
    expect(stop.disabled).toBe(true);
    expect(stop.textContent).toBe(t('load.stopping'));
    patchLoading(el, stateOf({ loadStopping: false }), tick);
    expect(stop.disabled).toBe(false);
    expect(stop.textContent).toBe(t('run.stop'));
  });

  it('opens already stopping when the state says so', () => {
    const [stop] = docked(loadingView(stateOf({ loadStopping: true }), vi.fn()));
    expect(stop.disabled).toBe(true);
    expect(stop.textContent).toBe(t('load.stopping'));
  });

  it('hides the progress line and the bar until the first page is read', () => {
    const el = loadingView(stateOf(), vi.fn());
    const [bar] = byClass(el, 'progress');
    expect(bar.hidden).toBe(true);
    expect(progressLine(el).hidden).toBe(true);
    expect(progressLine(el).textContent).toBe('');
  });

  it('shows the records read of the total with a bar like the running view', () => {
    const el = loadingView(stateOf({ loadProgress: { read: 500, total: 1234 } }), vi.fn());
    const [bar] = byClass(el, 'progress');
    expect(bar.hidden).toBe(false);
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('1234');
    expect(bar.getAttribute('aria-valuenow')).toBe('500');
    expect(bar.getAttribute('aria-label')).toBe(t('grid.loading'));
    expect(byClass(bar, 'fill')[0].style.width).toBe('41%');
    const line = progressLine(el);
    expect(line.hidden).toBe(false);
    expect(line.textContent).toBe(t('load.progress', { read: fmtInt(500), total: fmtInt(1234) }));
    // Строка и полоса — под заголовком, перед строкой ожидания.
    const order = findAll(el, (n) => n === bar || n === line || n.classes.has('wait') || n.attrs.has('data-main'));
    expect(order.map((n) => (n === bar ? 'bar' : n === line ? 'line' : n.classes.has('wait') ? 'wait' : 'heading'))).toEqual([
      'heading',
      'bar',
      'line',
      'wait',
    ]);
  });

  it('counts the records without a bar when Steam did not say how many there are', () => {
    const el = loadingView(stateOf({ loadProgress: { read: 1000, total: null } }), vi.fn());
    expect(byClass(el, 'progress')[0].hidden).toBe(true);
    expect(progressLine(el).hidden).toBe(false);
    expect(progressLine(el).textContent).toBe(t('load.progressCount', { read: fmtInt(1000) }));
    // Пустой инвентарь: всего ноль — число известно, а полосы нет.
    const empty = loadingView(stateOf({ loadProgress: { read: 0, total: 0 } }), vi.fn());
    expect(byClass(empty, 'progress')[0].hidden).toBe(true);
    expect(progressLine(empty).textContent).toBe(t('load.progress', { read: fmtInt(0), total: fmtInt(0) }));
  });

  it('never fills the bar past the end when more records were read than Steam named', () => {
    const el = loadingView(stateOf({ loadProgress: { read: 1300, total: 1234 } }), vi.fn());
    const [bar] = byClass(el, 'progress');
    expect(byClass(bar, 'fill')[0].style.width).toBe('100%');
    expect(bar.getAttribute('aria-valuenow')).toBe('1234');
  });

  it('updates the progress in place: the bar, the line and Stop stay the same nodes', () => {
    const tick = vi.fn();
    const el = loadingView(stateOf(), tick);
    const [bar] = byClass(el, 'progress');
    const fill = byClass(bar, 'fill')[0];
    const line = progressLine(el);
    const [stop] = docked(el);

    expect(patchLoading(el, stateOf({ loadProgress: { read: 500, total: 1234 } }), tick)).toBe(true);
    expect(patchLoading(el, stateOf({ loadProgress: { read: 1000, total: 1234 } }), tick)).toBe(true);
    expect(bar.hidden).toBe(false);
    expect(fill.style.width).toBe('81%');
    expect(bar.getAttribute('aria-valuenow')).toBe('1000');
    expect(line.textContent).toBe(t('load.progress', { read: fmtInt(1000), total: fmtInt(1234) }));
    expect(byClass(el, 'progress')).toHaveLength(1);
    expect(byClass(el, 'progress')[0]).toBe(bar);
    expect(byClass(bar, 'fill')[0]).toBe(fill);
    expect(progressLine(el)).toBe(line);
    expect(docked(el)).toHaveLength(1);
    expect(docked(el)[0]).toBe(stop);

    expect(patchLoading(el, stateOf({ loadProgress: { read: 1500, total: null } }), tick)).toBe(true);
    expect(bar.hidden).toBe(true);
    expect(line.textContent).toBe(t('load.progressCount', { read: fmtInt(1500) }));
  });

  it('does not patch a view that is not the load view', () => {
    expect(patchLoading(new FakeEl('div') as unknown as HTMLElement, stateOf(), vi.fn())).toBe(false);
  });

  it('calls stopLoad when Stop is clicked; a second click is swallowed by the loadStopping state', async () => {
    const stop = vi.fn(async () => {});
    useApi({ stop } as unknown as Api);
    initState(stateOf());
    const el = loadingView(getState(), vi.fn());
    const [button] = docked(el);
    fire(button, 'click');
    fire(button, 'click');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(getState().loadStopping).toBe(true);
  });
});
