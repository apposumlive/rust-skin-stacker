import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useApi, type Api, type WindowMetrics } from '../api';
import { defaultFilter } from '../model';
import { getState, initState, setState, subscribe, type State } from '../store';
import type { Settings } from '../types';
import { AUTO } from '../zoom';
import { currentAutoScale, RESIZE_DELAY, startZoom } from './zoom';

type Handler = (event: unknown) => void;

/** Окно для клавиш и задержки пересчёта. Размер окна берётся у ядра (`windowMetrics`), не у страницы. */
function fakeWindow() {
  const listeners = new Map<string, Handler[]>();
  return {
    addEventListener: (type: string, handler: Handler) => listeners.set(type, [...(listeners.get(type) ?? []), handler]),
    removeEventListener: (type: string, handler: Handler) =>
      listeners.set(type, (listeners.get(type) ?? []).filter((known) => known !== handler)),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => clearTimeout(id),
    listeners,
    fire(type: string, event: unknown = {}) {
      for (const handler of listeners.get(type) ?? []) handler(event);
    },
  };
}

/** Ответы подставного ядра приходят через несколько микрозадач. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

/**
 * Подставное ядро. Размер окна и высоту экрана (логические пиксели) задаёт тест; `setZoom` висит, пока тест
 * не ответит (`answer`, `refuse`). `resize` и `moveTo` — события окна: изменили размер, перетащили на другой экран.
 */
function fakeCore(width: number, height: number, monitorHeight: number) {
  const waiting: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
  const core = {
    metrics: { width, height, monitorHeight } as WindowMetrics,
    /** Факторы зума, которые окно попросило у ядра. */
    zooms: [] as number[],
    waiting,
    reads: 0,
    listener: null as (() => void) | null,
    unlistened: false,
    async answer() {
      waiting.shift()!.resolve();
      await flush();
    },
    async refuse() {
      waiting.shift()!.reject(new Error('denied'));
      await flush();
    },
    /** Отвечает на все смены зума, и на те, что начнутся после ответа. */
    async settle() {
      while (waiting.length) await core.answer();
    },
    resize(nextWidth: number, nextHeight: number) {
      core.metrics = { ...core.metrics, width: nextWidth, height: nextHeight };
      core.listener?.();
    },
    moveTo(nextMonitorHeight: number) {
      core.metrics = { ...core.metrics, monitorHeight: nextMonitorHeight };
      core.listener?.();
    },
  };
  const api = {
    setZoom: (factor: number) => {
      core.zooms.push(factor);
      return new Promise<void>((resolve, reject) => waiting.push({ resolve, reject }));
    },
    windowMetrics: vi.fn(async () => {
      core.reads += 1;
      return { ...core.metrics };
    }),
    onWindowChange: async (callback: () => void) => {
      core.listener = callback;
      return () => {
        core.listener = null;
        core.unlistened = true;
      };
    },
    saveSettings: (next: Settings) => save(next),
  };
  return { core, api: api as unknown as Api & { windowMetrics: Mock<Api['windowMetrics']> } };
}

const settings: Settings = { language: null, delayMs: 1500, uiScale: 100 };

function stateOf(over: Partial<State> = {}): State {
  return {
    screen: 'main',
    lang: 'en',
    settings,
    token: null,
    inventory: null,
    loading: false,
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

function press(code: string, over: Partial<KeyboardEvent> = {}) {
  const event = { key: '', code, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, preventDefault: vi.fn(), ...over };
  win.fire('keydown', event);
  return event;
}

let win: ReturnType<typeof fakeWindow>;
let core: ReturnType<typeof fakeCore>['core'];
let api: ReturnType<typeof fakeCore>['api'];
let save: Mock<Api['saveSettings']>;
let stop: (() => void) | null = null;
let cleanups: Array<() => void> = [];

/** Окно `width`×`height` на экране высотой `monitorHeight` (логические пиксели), масштаб `uiScale` в настройках. */
function prepare(uiScale: number, width: number, height: number, monitorHeight = 1080, over: Partial<State> = {}) {
  stop?.();
  win = fakeWindow();
  vi.stubGlobal('window', win);
  ({ core, api } = fakeCore(width, height, monitorHeight));
  useApi(api);
  initState(stateOf({ settings: { ...settings, uiScale }, ...over }));
}

/** То же, что `prepare`, и сразу запуск. */
async function start(uiScale: number, width: number, height: number, monitorHeight = 1080, over: Partial<State> = {}) {
  prepare(uiScale, width, height, monitorHeight, over);
  stop = startZoom();
  await flush();
}

/** Каждая новая ошибка в состоянии окна, по порядку. Подписка снимается после теста. */
function watchErrors(): unknown[] {
  const errors: unknown[] = [];
  let last = getState().error;
  cleanups.push(
    subscribe((state) => {
      if (state.error && state.error !== last) errors.push(state.error);
      last = state.error;
    }),
  );
  return errors;
}

/** Событие окна и пауза пересчёта. */
async function afterDelay(): Promise<void> {
  vi.advanceTimersByTime(RESIZE_DELAY);
  await flush();
}

const saved = () => save.mock.calls.map(([next]) => next.uiScale);

beforeEach(() => {
  vi.useFakeTimers();
  save = vi.fn<Api['saveSettings']>(async (next) => next);
});

afterEach(() => {
  stop?.();
  stop = null;
  for (const off of cleanups) off();
  cleanups = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('zoom at start', () => {
  it('applies the saved scale once the core gave the window size', async () => {
    await start(125, 1600, 1000);
    expect(core.zooms).toEqual([1.25]);
  });

  it('sets 100 % once, so the webview does not keep an old zoom', async () => {
    await start(100, 1280, 800);
    expect(core.zooms).toEqual([1]);
  });

  it('lowers the scale in a small window', async () => {
    await start(150, 1280, 800);
    expect(core.zooms).toEqual([1.25]);
  });

  it('listens to the window, not to the page resize', async () => {
    await start(100, 1280, 800);
    expect(core.listener).not.toBeNull();
    expect(win.listeners.get('resize')).toBeUndefined();
  });
});

describe('Auto', () => {
  it('takes 125 % on a screen 1440 px high and 100 % on a 1080 px one', async () => {
    await start(AUTO, 1440, 900, 1440);
    expect(core.zooms).toEqual([1.25]);
    await start(AUTO, 1440, 900, 1080);
    expect(core.zooms).toEqual([1]);
  });

  it('takes 100 % when the core does not know the screen', async () => {
    await start(AUTO, 1440, 900, 0);
    expect(core.zooms).toEqual([1]);
  });

  it('still fits the window', async () => {
    await start(AUTO, 1100, 700, 1440);
    expect(core.zooms).toEqual([1]);
  });

  it('follows the window to another screen', async () => {
    await start(AUTO, 1440, 900, 1080);
    await core.settle();
    core.moveTo(1440);
    await afterDelay();
    expect(core.zooms).toEqual([1, 1.25]);
  });

  it('tells the settings panel what it gives on this screen now', async () => {
    await start(AUTO, 1440, 900, 1440);
    expect(currentAutoScale()).toBe(125);
    core.moveTo(1200);
    await afterDelay();
    expect(currentAutoScale()).toBe(110);
  });
});

describe('zoom on window change', () => {
  it('waits for the window to settle, then lowers and raises the scale', async () => {
    await start(150, 1800, 1200);
    await core.settle();
    expect(core.zooms).toEqual([1.5]);
    core.resize(1500, 900);
    vi.advanceTimersByTime(RESIZE_DELAY - 1);
    await flush();
    expect(core.zooms).toEqual([1.5]);
    vi.advanceTimersByTime(1);
    await flush();
    expect(core.zooms).toEqual([1.5, 1.25]);
    await core.settle();
    core.resize(1800, 1200);
    await afterDelay();
    expect(core.zooms).toEqual([1.5, 1.25, 1.5]);
  });

  it('reads the size once after many events', async () => {
    await start(150, 1800, 1200);
    await core.settle();
    for (const width of [1700, 1600, 1500]) {
      core.resize(width, 900);
      vi.advanceTimersByTime(RESIZE_DELAY / 2);
    }
    await afterDelay();
    expect(core.reads).toBe(2);
    expect(core.zooms).toEqual([1.5, 1.25]);
  });

  it('does not call the core when the scale stays the same', async () => {
    await start(125, 1600, 1000);
    await core.settle();
    core.resize(1700, 1100);
    await afterDelay();
    expect(core.zooms).toEqual([1.25]);
  });

  it('takes the last size when the answers come out of order', async () => {
    await start(150, 1800, 1200);
    await core.settle();
    const answers: Array<(metrics: WindowMetrics) => void> = [];
    api.windowMetrics.mockImplementation(() => new Promise<WindowMetrics>((resolve) => answers.push(resolve)));
    core.resize(1500, 900);
    await afterDelay();
    core.resize(1800, 1200);
    await afterDelay();
    answers[1]({ width: 1800, height: 1200, monitorHeight: 1080 });
    await flush();
    answers[0]({ width: 1500, height: 900, monitorHeight: 1080 });
    await flush();
    expect(core.zooms).toEqual([1.5]);
  });

  it('ignores the 0×0 size of a minimized window and takes the next real one', async () => {
    await start(AUTO, 1440, 900, 1440);
    await core.settle();
    expect(core.zooms).toEqual([1.25]);
    // Windows: свёрнутое окно отдаёт 0×0. Масштаб не трогаем ни при сворачивании, ни при разворачивании.
    core.resize(0, 0);
    await afterDelay();
    expect(core.zooms).toEqual([1.25]);
    expect(core.waiting).toHaveLength(0);
    core.resize(1440, 900);
    await afterDelay();
    expect(core.zooms).toEqual([1.25]);
    core.resize(1100, 700);
    await afterDelay();
    expect(core.zooms).toEqual([1.25, 1]);
  });

  it('ignores a size with one side 0, also for a plain scale', async () => {
    await start(125, 1600, 1000);
    await core.settle();
    core.resize(1600, 0);
    await afterDelay();
    core.resize(0, 1000);
    await afterDelay();
    expect(core.zooms).toEqual([1.25]);
  });

  it('waits for a real size when the window starts minimized', async () => {
    await start(125, 0, 0);
    expect(core.zooms).toEqual([]);
    expect(getState().error).toBeNull();
    core.resize(1600, 1000);
    await afterDelay();
    expect(core.zooms).toEqual([1.25]);
  });
});

describe('one zoom change at a time', () => {
  it('starts no new change until the core answered, then applies the last choice', async () => {
    await start(100, 1800, 1200);
    press('Equal');
    press('Equal');
    press('Equal');
    expect(core.zooms).toEqual([1]);
    expect(saved()).toEqual([110, 125, 150]);
    await core.answer();
    expect(core.zooms).toEqual([1, 1.5]);
    await core.answer();
    expect(core.zooms).toEqual([1, 1.5]);
    expect(core.waiting).toHaveLength(0);
  });

  it('applies a window change that came while the zoom was changing', async () => {
    await start(150, 1800, 1200);
    core.resize(1500, 900);
    await afterDelay();
    expect(core.zooms).toEqual([1.5]);
    await core.answer();
    expect(core.zooms).toEqual([1.5, 1.25]);
  });

  it('skips a choice that was taken back while the zoom was changing', async () => {
    await start(100, 1800, 1200);
    press('Equal');
    press('Minus');
    await core.settle();
    expect(core.zooms).toEqual([1]);
  });
});

describe('zoom keys', () => {
  it('Ctrl+= applies the next scale at once and saves it, the settings panel stays open', async () => {
    await start(100, 1600, 1000, 1080, { settingsOpen: true });
    await core.settle();
    const event = press('Equal', { key: '=' });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(core.zooms).toEqual([1, 1.1]);
    expect(save).toHaveBeenCalledWith({ ...settings, uiScale: 110 });
    await flush();
    expect(getState().settings.uiScale).toBe(110);
    expect(getState().settingsOpen).toBe(true);
  });

  it('steps from what Auto gives now and saves a plain scale', async () => {
    await start(AUTO, 1800, 1200, 1440);
    await core.settle();
    press('Equal');
    expect(core.zooms).toEqual([1.25, 1.5]);
    expect(saved()).toEqual([150]);
    await flush();
    await start(AUTO, 1800, 1200, 1440);
    await core.settle();
    press('Minus');
    expect(core.zooms).toEqual([1.25, 1.1]);
    expect(saved()).toEqual([150, 110]);
  });

  it('Ctrl+0 returns to Auto, not to 100', async () => {
    await start(150, 1800, 1200, 1440);
    await core.settle();
    press('Digit0');
    expect(saved()).toEqual([AUTO]);
    expect(core.zooms).toEqual([1.5, 1.25]);
    await core.settle();
    press('Numpad0');
    expect(saved()).toEqual([AUTO]);
  });

  it('works in another keyboard layout', async () => {
    await start(100, 1600, 1000);
    await core.settle();
    press('Equal', { key: 'ъ' });
    expect(core.zooms).toEqual([1, 1.1]);
  });

  it('does nothing at the edge', async () => {
    await start(150, 1800, 1200);
    press('Equal');
    await start(100, 1600, 1000);
    press('Minus');
    await start(AUTO, 1600, 1000);
    press('Digit0');
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps Auto when the step at the edge gives what Auto gives now', async () => {
    await start(AUTO, 1440, 900, 1080);
    await core.settle();
    const event = press('Minus');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(core.zooms).toEqual([1]);
    // Выбрано по-прежнему «Авто»: на экране 1440 px окно само переходит на 125 %.
    core.moveTo(1440);
    await afterDelay();
    expect(core.zooms).toEqual([1, 1.25]);
    // Экран неизвестен: «Авто» даёт 100, Ctrl+− тоже ничего не сохраняет.
    await start(AUTO, 1440, 900, 0);
    press('Minus');
    expect(save).not.toHaveBeenCalled();
  });

  it('saves the choice even if the window is too small to show it', async () => {
    await start(100, 1024, 640);
    await core.settle();
    press('Equal');
    expect(core.zooms).toEqual([1]);
    expect(save).toHaveBeenCalledWith({ ...settings, uiScale: 110 });
  });

  it('ignores other keys and Alt', async () => {
    await start(100, 1600, 1000);
    await core.settle();
    const event = press('Equal', { altKey: true });
    press('KeyR');
    press('Equal', { ctrlKey: false });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(core.zooms).toEqual([1]);
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps the new scale until restart when saving fails', async () => {
    save.mockRejectedValue({ code: 'settingsNotSaved' });
    await start(100, 1600, 1000);
    await core.settle();
    press('Equal');
    await core.settle();
    expect(getState().error).toEqual({ code: 'settingsNotSaved', status: null });
    expect(getState().settings.uiScale).toBe(100);
    core.resize(1700, 1100);
    await afterDelay();
    expect(core.zooms).toEqual([1, 1.1]);
    // Следующая клавиша идёт от выбранного 110, а не от сохранённого 100.
    press('Equal');
    expect(core.zooms).toEqual([1, 1.1, 1.25]);
  });
});

describe('zoom from the settings', () => {
  it('applies the scale saved in the settings panel', async () => {
    await start(100, 1600, 1000);
    await core.settle();
    setState({ settings: { ...settings, uiScale: 125 }, settingsOpen: false });
    expect(core.zooms).toEqual([1, 1.25]);
  });

  it('applies Auto saved in the settings panel', async () => {
    await start(150, 1800, 1200, 1080);
    await core.settle();
    setState({ settings: { ...settings, uiScale: AUTO } });
    expect(core.zooms).toEqual([1.5, 1]);
  });

  it('ignores other changes of the window state', async () => {
    await start(125, 1600, 1000);
    setState({ loading: true });
    setState({ settings: { ...settings, language: 'ru', uiScale: 125 } });
    await core.settle();
    expect(core.zooms).toEqual([1.25]);
  });
});

describe('zoom errors', () => {
  it('keeps the old zoom and shows the error when the core refuses', async () => {
    await start(100, 1800, 1200);
    await core.settle();
    press('Equal');
    await core.refuse();
    expect(getState().error).toEqual({ code: 'zoomFailed', status: null });
    // Не повторяет сам: ошибка не пойдёт по кругу.
    expect(core.waiting).toHaveLength(0);
    // Применён прежний 100: Ctrl+− к 100 ядро не зовёт.
    press('Minus');
    expect(core.zooms).toEqual([1, 1.1]);
  });

  it('shows the error on the login screen too', async () => {
    await start(125, 1600, 1000, 1080, { screen: 'login' });
    await core.refuse();
    expect(getState().error).toEqual({ code: 'zoomFailed', status: null });
  });

  it('clears the scale error once a later zoom change worked', async () => {
    await start(125, 1600, 1000);
    await core.refuse();
    expect(getState().error).toEqual({ code: 'zoomFailed', status: null });
    core.resize(1100, 700);
    await afterDelay();
    expect(core.zooms).toEqual([1.25, 1]);
    expect(getState().error).toEqual({ code: 'zoomFailed', status: null });
    await core.answer();
    expect(getState().error).toBeNull();
  });

  it('keeps the error the same key press showed while its save was still on the way', async () => {
    await start(100, 1800, 1200);
    await core.settle();
    let saved: (settings: Settings) => void = () => {};
    save.mockImplementation(() => new Promise<Settings>((resolve) => (saved = resolve)));
    press('Equal');
    await core.refuse();
    expect(getState().error).toEqual({ code: 'zoomFailed', status: null });
    saved({ ...settings, uiScale: 110 });
    await flush();
    expect(getState().settings.uiScale).toBe(110);
    expect(getState().error).toEqual({ code: 'zoomFailed', status: null });
  });

  it('leaves other errors alone when the zoom changes', async () => {
    await start(150, 1800, 1200);
    await core.settle();
    setState({ error: { code: 'network', status: null } });
    core.resize(1500, 900);
    await afterDelay();
    await core.answer();
    expect(core.zooms).toEqual([1.5, 1.25]);
    expect(getState().error).toEqual({ code: 'network', status: null });
  });

  it('does not ask for the refused scale again on a window change, but does after a key', async () => {
    await start(125, 1600, 1000);
    await core.refuse();
    core.resize(1601, 1000);
    await afterDelay();
    expect(core.zooms).toEqual([1.25]);
    press('Minus');
    expect(core.zooms).toEqual([1.25, 1.1]);
  });
});

describe('window size errors', () => {
  it('shows the error once when the window size cannot be read, and applies the scale after a later read', async () => {
    prepare(100, 1600, 1000);
    api.windowMetrics.mockRejectedValue(new Error('denied'));
    const errors = watchErrors();
    stop = startZoom();
    await flush();
    expect(core.zooms).toEqual([]);
    expect(getState().error).toEqual({ code: 'zoomFailed', status: null });
    // Клавиша, сохранение настроек и новый неудачный замер масштаб не применяют, ошибка не повторяется.
    press('Equal');
    await flush();
    expect(saved()).toEqual([110]);
    setState({ settings: { ...settings, uiScale: 125 } });
    core.resize(1600, 1000);
    await afterDelay();
    expect(core.zooms).toEqual([]);
    expect(errors).toHaveLength(1);
    // Размер прочитался: применяется выбранный.
    api.windowMetrics.mockImplementation(async () => ({ ...core.metrics }));
    core.resize(1600, 1000);
    await afterDelay();
    expect(core.zooms).toEqual([1.25]);
    expect(errors).toHaveLength(1);
  });

  it('shows the error on the login screen too', async () => {
    prepare(125, 1600, 1000, 1080, { screen: 'login' });
    api.windowMetrics.mockRejectedValue(new Error('denied'));
    stop = startZoom();
    await flush();
    expect(getState().error).toEqual({ code: 'zoomFailed', status: null });
  });

  it('keeps the last size without an error when a later read fails', async () => {
    await start(150, 1800, 1200);
    await core.settle();
    api.windowMetrics.mockRejectedValueOnce(new Error('denied'));
    core.resize(1500, 900);
    await afterDelay();
    expect(getState().error).toBeNull();
    expect(core.zooms).toEqual([1.5]);
    press('Minus');
    expect(core.zooms).toEqual([1.5, 1.25]);
  });

  it('shows the error when the window events cannot be listened to, the scale is still applied', async () => {
    prepare(125, 1600, 1000);
    api.onWindowChange = async () => {
      throw new Error('denied');
    };
    const errors = watchErrors();
    stop = startZoom();
    await flush();
    expect(core.zooms).toEqual([1.25]);
    expect(errors).toEqual([{ code: 'zoomFailed', status: null }]);
  });

  it('shows one error when both the size and the window events fail', async () => {
    prepare(125, 1600, 1000);
    api.windowMetrics.mockRejectedValue(new Error('denied'));
    api.onWindowChange = async () => {
      throw new Error('denied');
    };
    const errors = watchErrors();
    stop = startZoom();
    await flush();
    expect(errors).toEqual([{ code: 'zoomFailed', status: null }]);
  });

  it('shows nothing when it stopped before the read failed', async () => {
    prepare(125, 1600, 1000);
    api.windowMetrics.mockRejectedValue(new Error('denied'));
    startZoom()();
    await flush();
    expect(getState().error).toBeNull();
  });
});

describe('stopping', () => {
  it('removes its listeners', async () => {
    await start(100, 1600, 1000);
    await core.settle();
    stop?.();
    stop = null;
    expect(win.listeners.get('keydown') ?? []).toHaveLength(0);
    expect(core.unlistened).toBe(true);
    setState({ settings: { ...settings, uiScale: 150 } });
    expect(core.zooms).toEqual([1]);
  });

  it('drops the window events and the size that come after it stopped', async () => {
    win = fakeWindow();
    vi.stubGlobal('window', win);
    ({ core, api } = fakeCore(1600, 1000, 1080));
    useApi(api);
    initState(stateOf());
    startZoom()();
    await flush();
    expect(core.unlistened).toBe(true);
    expect(core.zooms).toEqual([]);
  });
});
