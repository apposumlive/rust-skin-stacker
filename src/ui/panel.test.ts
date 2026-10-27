import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl } from './fake-dom';
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
