// Вызовы ядра. В обычном браузере (`npm run dev` без Tauri) main.ts подменяет api демо-режимом.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Lang } from './i18n';
import type { Inventory, Operation, Plan, Progress, Settings, StartResult, TokenInfo, UiError } from './types';

export const TOKEN_PAGE = 'https://steamcommunity.com/pointssummary/ajaxgetasyncconfig';

/** Размер окна и высота экрана в логических пикселях: от зума WebView они не зависят. */
export interface WindowMetrics {
  width: number;
  height: number;
  /** 0 — экран неизвестен. */
  monitorHeight: number;
}

export interface Api {
  setToken(raw: string): Promise<TokenInfo>;
  forgetToken(): Promise<void>;
  loadInventory(lang: Lang): Promise<Inventory>;
  preview(operation: Operation): Promise<Plan>;
  start(operation: Operation, lang: Lang): Promise<StartResult>;
  stop(): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<Settings>;
  journal(): Promise<string>;
  onProgress(callback: (progress: Progress) => void): Promise<() => void>;
  openTokenPage(): Promise<void>;
  /** Зум всего окна: 1 — 100 %, 1.25 — 125 %. */
  setZoom(factor: number): Promise<void>;
  windowMetrics(): Promise<WindowMetrics>;
  /** Окно изменило размер или перешло на экран с другим масштабом системы. */
  onWindowChange(callback: () => void): Promise<() => void>;
}

async function tauriWindowMetrics(): Promise<WindowMetrics> {
  const win = getCurrentWindow();
  // Экран нужен только «Авто»: не нашёлся — 0, размер окна всё равно отдаём.
  const [size, factor, monitor] = await Promise.all([
    win.innerSize(),
    win.scaleFactor(),
    currentMonitor().catch(() => null),
  ]);
  const { width, height } = size.toLogical(factor);
  return { width, height, monitorHeight: monitor ? monitor.size.toLogical(monitor.scaleFactor).height : 0 };
}

async function onTauriWindowChange(callback: () => void): Promise<() => void> {
  const win = getCurrentWindow();
  const offResized = await win.onResized(() => callback());
  try {
    const offScale = await win.onScaleChanged(() => callback());
    return () => {
      offResized();
      offScale();
    };
  } catch (e) {
    offResized();
    throw e;
  }
}

const tauriApi: Api = {
  setToken: (raw) => invoke<TokenInfo>('set_token', { raw }),
  forgetToken: () => invoke<void>('forget_token'),
  loadInventory: (lang) => invoke<Inventory>('load_inventory', { lang }),
  preview: (operation) => invoke<Plan>('preview', { operation }),
  start: (operation, lang) => invoke<StartResult>('start', { operation, lang }),
  stop: () => invoke<void>('stop'),
  getSettings: () => invoke<Settings>('get_settings'),
  saveSettings: (settings) => invoke<Settings>('save_settings', { settings }),
  journal: () => invoke<string>('journal'),
  onProgress: (callback) => listen<Progress>('run-progress', (event) => callback(event.payload)),
  openTokenPage: () => openUrl(TOKEN_PAGE),
  setZoom: (factor) => getCurrentWebview().setZoom(factor),
  windowMetrics: tauriWindowMetrics,
  onWindowChange: onTauriWindowChange,
};

export let api: Api = tauriApi;

export function useApi(next: Api): void {
  api = next;
}

export function inTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

/** Ошибка команды как `UiError`; всё непонятное — код `unknown`. */
export function asUiError(error: unknown): UiError {
  if (typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string') {
    const { code, status } = error as { code: string; status?: unknown };
    return { code, status: typeof status === 'number' ? status : null };
  }
  return { code: 'unknown', status: null };
}
