import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useApi, type Api } from '../api';
import { defaultFilter } from '../model';
import { getState, initState, setState, type State } from '../store';
import type { Settings } from '../types';
import { RESIZE_DELAY, startZoom } from './zoom';

type Handler = (event: unknown) => void;

/**
 * Окно с зумом WebView: `logical` — размер окна на экране, `innerWidth/innerHeight` — он же в CSS-пикселях
 * при текущем зуме, как в браузере. Зум меняет только `setZoom` подставного ядра.
 */
function fakeWindow(width: number, height: number) {
  const listeners = new Map<string, Handler[]>();
  const win = {
    logical: { width, height },
    zoom: 1,
    get innerWidth() {
      return Math.round(win.logical.width / win.zoom);
    },
    get innerHeight() {
      return Math.round(win.logical.height / win.zoom);
    },
    addEventListener: (type: string, handler: Handler) => listeners.set(type, [...(listeners.get(type) ?? []), handler]),
    removeEventListener: (type: string, handler: Handler) =>
      listeners.set(type, (listeners.get(type) ?? []).filter((known) => known !== handler)),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => clearTimeout(id),
    listeners,
    fire(type: string, event: unknown = {}) {
      for (const handler of listeners.get(type) ?? []) handler(event);
    },
    resize(next: number, nextHeight: number) {
      win.logical = { width: next, height: nextHeight };
      win.fire('resize');
    },
  };
  return win;
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

/** Ответы подставного ядра приходят через несколько микрозадач. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

let win: ReturnType<typeof fakeWindow>;
let setZoom: Mock<Api['setZoom']>;
let save: Mock<Api['saveSettings']>;
let stop: (() => void) | null = null;

function start(uiScale: number, width: number, height: number, over: Partial<State> = {}) {
  stop?.();
  win = fakeWindow(width, height);
  vi.stubGlobal('window', win);
  initState(stateOf({ settings: { ...settings, uiScale }, ...over }));
  stop = startZoom();
}

/** Факторы зума, которые окно попросило у ядра. */
const zooms = () => setZoom.mock.calls.map(([factor]) => factor);

beforeEach(() => {
  vi.useFakeTimers();
  setZoom = vi.fn<Api['setZoom']>(async (factor) => {
    win.zoom = factor;
  });
  save = vi.fn<Api['saveSettings']>(async (next) => next);
  useApi({ setZoom, saveSettings: save } as unknown as Api);
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('zoom at start', () => {
  it('applies the saved scale', () => {
    start(125, 1600, 1000);
    expect(zooms()).toEqual([1.25]);
  });

  it('sets 100 % once, so the webview does not keep an old zoom', () => {
    start(100, 1280, 800);
    expect(zooms()).toEqual([1]);
  });

  it('lowers the scale in a small window', () => {
    start(150, 1280, 800);
    expect(zooms()).toEqual([1.25]);
  });
});

describe('zoom on resize', () => {
  it('waits for the window to settle, then lowers and raises the scale', () => {
    start(150, 1800, 1200);
    expect(zooms()).toEqual([1.5]);
    win.resize(1500, 900);
    vi.advanceTimersByTime(RESIZE_DELAY - 1);
    expect(zooms()).toEqual([1.5]);
    vi.advanceTimersByTime(1);
    expect(zooms()).toEqual([1.5, 1.25]);
    win.resize(1800, 1200);
    vi.advanceTimersByTime(RESIZE_DELAY);
    expect(zooms()).toEqual([1.5, 1.25, 1.5]);
  });

  it('counts only the last of many resize events', () => {
    start(150, 1800, 1200);
    for (const width of [1700, 1600, 1500]) {
      win.resize(width, 900);
      vi.advanceTimersByTime(RESIZE_DELAY / 2);
    }
    vi.advanceTimersByTime(RESIZE_DELAY);
    expect(zooms()).toEqual([1.5, 1.25]);
  });

  it('does not call the core when the scale stays the same', () => {
    start(125, 1600, 1000);
    win.resize(1700, 1100);
    vi.advanceTimersByTime(RESIZE_DELAY);
    expect(zooms()).toEqual([1.25]);
  });
});

describe('zoom keys', () => {
  it('Ctrl+= applies the next scale at once and saves it, the settings panel stays open', async () => {
    start(100, 1600, 1000, { settingsOpen: true });
    const event = press('Equal', { key: '=' });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(zooms()).toEqual([1, 1.1]);
    expect(save).toHaveBeenCalledWith({ ...settings, uiScale: 110 });
    await flush();
    expect(getState().settings.uiScale).toBe(110);
    expect(getState().settingsOpen).toBe(true);
  });

  it('Ctrl+− goes down, Ctrl+0 goes back to 100', () => {
    start(150, 1800, 1200);
    press('Minus');
    press('Numpad0');
    expect(zooms()).toEqual([1.5, 1.25, 1]);
    expect(save.mock.calls.map(([next]) => next.uiScale)).toEqual([125, 100]);
  });

  it('works in another keyboard layout', () => {
    start(100, 1600, 1000);
    press('Equal', { key: 'ъ' });
    expect(zooms()).toEqual([1, 1.1]);
  });

  it('does nothing at the edge', () => {
    start(150, 1800, 1200);
    press('Equal');
    start(100, 1600, 1000);
    press('Digit0');
    press('Minus');
    expect(save).not.toHaveBeenCalled();
  });

  it('saves the choice even if the window is too small to show it', () => {
    start(100, 1024, 640);
    press('Equal');
    expect(zooms()).toEqual([1]);
    expect(save).toHaveBeenCalledWith({ ...settings, uiScale: 110 });
  });

  it('ignores other keys and Alt', () => {
    start(100, 1600, 1000);
    const event = press('Equal', { altKey: true });
    press('KeyR');
    press('Equal', { ctrlKey: false });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(zooms()).toEqual([1]);
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps the new scale until restart when saving fails', async () => {
    save.mockRejectedValue({ code: 'settingsNotSaved' });
    start(100, 1600, 1000);
    press('Equal');
    await flush();
    expect(getState().error).toEqual({ code: 'settingsNotSaved', status: null });
    expect(getState().settings.uiScale).toBe(100);
    win.resize(1700, 1100);
    vi.advanceTimersByTime(RESIZE_DELAY);
    expect(zooms()).toEqual([1, 1.1]);
    // Следующая клавиша идёт от выбранного 110, а не от сохранённого 100.
    press('Equal');
    expect(zooms()).toEqual([1, 1.1, 1.25]);
  });
});

describe('zoom from the settings', () => {
  it('applies the scale saved in the settings panel', () => {
    start(100, 1600, 1000);
    setState({ settings: { ...settings, uiScale: 125 }, settingsOpen: false });
    expect(zooms()).toEqual([1, 1.25]);
  });

  it('ignores other changes of the window state', () => {
    start(125, 1600, 1000);
    setState({ loading: true });
    setState({ settings: { ...settings, language: 'ru', uiScale: 125 } });
    expect(zooms()).toEqual([1.25]);
  });
});

describe('zoom errors', () => {
  it('tries again on the next resize when the core did not change the zoom', async () => {
    setZoom.mockRejectedValueOnce(new Error('denied'));
    start(125, 1600, 1000);
    await flush();
    win.resize(1601, 1000);
    vi.advanceTimersByTime(RESIZE_DELAY);
    expect(zooms()).toEqual([1.25, 1.25]);
  });
});

describe('stopping', () => {
  it('removes its listeners', () => {
    start(100, 1600, 1000);
    stop?.();
    stop = null;
    expect(win.listeners.get('keydown') ?? []).toHaveLength(0);
    expect(win.listeners.get('resize') ?? []).toHaveLength(0);
    setState({ settings: { ...settings, uiScale: 150 } });
    expect(zooms()).toEqual([1]);
  });
});
