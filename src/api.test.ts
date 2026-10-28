import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

// Подставное окно Tauri (vi.mock поднимается выше импортов): физический размер и масштаб системы задаёт тест.
const tauri = vi.hoisted(() => {
  const physical = (width: number, height: number) => ({
    toLogical: (factor: number) => ({ width: width / factor, height: height / factor }),
  });
  const win = { innerSize: vi.fn(), scaleFactor: vi.fn(), onResized: vi.fn(), onScaleChanged: vi.fn(), onMoved: vi.fn() };
  return { physical, win, currentMonitor: vi.fn() };
});

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => tauri.win,
  currentMonitor: tauri.currentMonitor,
}));

beforeEach(() => {
  tauri.win.innerSize.mockResolvedValue(tauri.physical(1800, 1125));
  tauri.win.scaleFactor.mockResolvedValue(1.25);
  tauri.currentMonitor.mockResolvedValue({ size: tauri.physical(2560, 1440), scaleFactor: 1 });
});

describe('windowMetrics', () => {
  it('gives the window and the screen in logical pixels', async () => {
    tauri.currentMonitor.mockResolvedValue({ size: tauri.physical(5120, 2880), scaleFactor: 2 });
    expect(await api.windowMetrics()).toEqual({ width: 1440, height: 900, monitorHeight: 1440 });
  });

  it('gives screen 0 when there is no monitor', async () => {
    tauri.currentMonitor.mockResolvedValue(null);
    expect(await api.windowMetrics()).toEqual({ width: 1440, height: 900, monitorHeight: 0 });
  });

  it('still gives the window size when the monitor lookup fails', async () => {
    tauri.currentMonitor.mockRejectedValue(new Error('denied'));
    expect(await api.windowMetrics()).toEqual({ width: 1440, height: 900, monitorHeight: 0 });
  });

  it('fails when the window size cannot be read', async () => {
    tauri.win.innerSize.mockRejectedValue(new Error('denied'));
    await expect(api.windowMetrics()).rejects.toThrow('denied');
  });
});


describe('onWindowChange', () => {
  /** Подписка на событие окна: запоминает обработчик, отписка считается. */
  function event() {
    const one = { handler: null as (() => void) | null, off: vi.fn() };
    const subscribe = async (handler: () => void) => {
      one.handler = handler;
      return one.off;
    };
    return { one, subscribe };
  }

  it('calls back when the window is resized, moved to another screen or its screen changes the scale', async () => {
    const [resized, scale, moved] = [event(), event(), event()];
    tauri.win.onResized.mockImplementation(resized.subscribe);
    tauri.win.onScaleChanged.mockImplementation(scale.subscribe);
    tauri.win.onMoved.mockImplementation(moved.subscribe);
    const callback = vi.fn();
    const off = await api.onWindowChange(callback);
    moved.one.handler?.();
    expect(callback).toHaveBeenCalledTimes(1);
    resized.one.handler?.();
    scale.one.handler?.();
    expect(callback).toHaveBeenCalledTimes(3);
    off();
    for (const e of [resized, scale, moved]) expect(e.one.off).toHaveBeenCalledTimes(1);
  });

  it('drops the events it already listens to when moving cannot be listened to', async () => {
    const [resized, scale] = [event(), event()];
    tauri.win.onResized.mockImplementation(resized.subscribe);
    tauri.win.onScaleChanged.mockImplementation(scale.subscribe);
    tauri.win.onMoved.mockRejectedValue(new Error('denied'));
    await expect(api.onWindowChange(vi.fn())).rejects.toThrow('denied');
    expect(resized.one.off).toHaveBeenCalledTimes(1);
    expect(scale.one.off).toHaveBeenCalledTimes(1);
  });

  it('does not listen further when the scale cannot be listened to', async () => {
    const resized = event();
    tauri.win.onResized.mockImplementation(resized.subscribe);
    tauri.win.onScaleChanged.mockRejectedValue(new Error('denied'));
    tauri.win.onMoved.mockClear();
    await expect(api.onWindowChange(vi.fn())).rejects.toThrow('denied');
    expect(resized.one.off).toHaveBeenCalledTimes(1);
    expect(tauri.win.onMoved).not.toHaveBeenCalled();
  });
});
