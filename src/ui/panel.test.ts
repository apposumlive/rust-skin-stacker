import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang, t } from '../i18n';
import { defaultFilter } from '../model';
import type { Panel, State } from '../store';
import type { Inventory, Plan, Skin } from '../types';
import { byClass, byTag, FakeEl, fakeDocument } from './fake-dom';
import { createPanel } from './panel';

// Удержанный Enter на «Отделить N» открывал план, фокус переходил на «Запустить», и автоповтор нажимал её, а затем «Остановить».

interface Key {
  key: string;
  repeat: boolean;
  preventDefault: () => void;
}

function press(el: FakeEl, key: string, repeat: boolean): boolean {
  const event: Key = { key, repeat, preventDefault: vi.fn() };
  for (const handler of el.listeners.get('keydown') ?? []) handler(event);
  return vi.mocked(event.preventDefault).mock.calls.length > 0;
}

beforeEach(() => {
  vi.stubGlobal('window', { setInterval: vi.fn(), clearInterval: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('panel keys', () => {
  it('swallows a held Enter or Space before it reaches the newly focused button', () => {
    const el = new FakeEl('aside');
    createPanel(el as unknown as HTMLElement);
    const [handler] = el.listeners.get('keydown') ?? [];
    expect(handler).toBeDefined();
    // Фаза перехвата: обработчик срабатывает раньше, чем кнопка получит нажатие.
    expect(el.captures.has(handler)).toBe(true);
    expect(press(el, 'Enter', true)).toBe(true);
    expect(press(el, ' ', true)).toBe(true);
  });

  it('lets a normal press and repeated arrows through', () => {
    const el = new FakeEl('aside');
    createPanel(el as unknown as HTMLElement);
    expect(press(el, 'Enter', false)).toBe(false);
    expect(press(el, ' ', false)).toBe(false);
    expect(press(el, 'ArrowRight', true)).toBe(false);
  });

  it('removes the listener when the screen goes away', () => {
    const el = new FakeEl('aside');
    const part = createPanel(el as unknown as HTMLElement);
    part.destroy?.();
    expect(el.listeners.get('keydown') ?? []).toHaveLength(0);
    expect(el.captures.size).toBe(0);
  });
});

describe('focus after Run', () => {
  const skin: Skin = {
    key: 'A',
    name: 'Skin A',
    icon: null,
    category: null,
    total: 8,
    records: [{ assetid: '1001', classid: 'c1', instanceid: '0', amount: 8, tradable: true, marketable: true, availableAfter: null }],
  };
  const inventory: Inventory = { skins: [skin], unreadable: [] };
  const plan: Plan = { operation: { kind: 'splitAll' }, requests: 7, stacks: 1, queue: [{ key: 'A', amount: 8, requests: 7 }], more: 0, after: [] };
  const running = (patch: Partial<Extract<Panel, { kind: 'running' }>> = {}): Panel => ({
    kind: 'running',
    plan,
    done: 0,
    total: 7,
    errors: 0,
    key: '',
    processed: [],
    waitUntil: null,
    stopping: false,
    ...patch,
  });
  const stateOf = (panel: Panel): State => ({
    screen: 'main',
    lang: 'en',
    settings: { language: null, delayMs: 1500 },
    token: null,
    inventory,
    loading: false,
    error: null,
    tokenExpired: false,
    filter: defaultFilter(),
    selected: [],
    anchor: null,
    panel,
    menuOpen: false,
    settingsOpen: false,
  });

  beforeEach(() => {
    setLang('en');
    vi.stubGlobal('document', fakeDocument);
    vi.stubGlobal('HTMLElement', FakeEl);
    fakeDocument.activeElement = null;
  });

  it('lands on the heading of the running view, so a second Enter or Space cannot stop the run', () => {
    const el = new FakeEl('aside');
    const part = createPanel(el as unknown as HTMLElement);
    part.update(stateOf({ kind: 'plan', plan, changed: false }));
    expect(fakeDocument.activeElement?.textContent).toBe(t('plan.run'));

    part.update(stateOf(running()));
    const focused = fakeDocument.activeElement;
    expect(focused?.tag).toBe('h2');
    expect(focused?.textContent).toBe(t('run.title', { op: t('op.splitAll') }));
    expect(focused?.getAttribute('tabindex')).toBe('-1');
    expect(focused?.textContent).not.toBe(t('run.stop'));

    // Ход правится на месте: фокус остаётся на заголовке.
    part.update(stateOf(running({ done: 1, key: 'A' })));
    expect(fakeDocument.activeElement).toBe(focused);
    expect(el.contains(focused)).toBe(true);
  });

  it('keeps Stop focused across progress events once Tab reached it', () => {
    const el = new FakeEl('aside');
    const part = createPanel(el as unknown as HTMLElement);
    part.update(stateOf(running()));
    const stop = byTag(byClass(el, 'dock')[0], 'button')[0];
    expect(stop.textContent).toBe(t('run.stop'));
    stop.focus();
    part.update(stateOf(running({ done: 2, key: 'A' })));
    expect(fakeDocument.activeElement).toBe(stop);
    expect(byTag(byClass(el, 'dock')[0], 'button')[0]).toBe(stop);
  });
});
