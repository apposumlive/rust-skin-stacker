// Действия окна: всё, что меняет состояние и вызывает ядро.

import { api, asUiError } from './api';
import { detectLang, setLang, type Lang } from './i18n';
import { categoriesOf, nextSelection, type Filter, type SelectMode } from './model';
import { getState, setState, type Panel } from './store';
import type { Operation, Plan, Progress, Settings, UiError } from './types';

const TOKEN_CODES = new Set(['tokenExpired', 'tokenRejected', 'noToken']);

// Номер сессии токена: растёт в «Забыть токен». Ответ, начатый в прошлой сессии, в окно не попадает.
let session = 0;

/** Ошибка токена — плашка «Токен истёк», любая другая — плашка с текстом ошибки. */
function showError(error: UiError): void {
  if (TOKEN_CODES.has(error.code)) setState({ tokenExpired: true, error: null });
  else setState({ error });
}

export async function loadInventory(): Promise<void> {
  const mine = session;
  setState({ loading: true, error: null });
  try {
    const inventory = await api.loadInventory(getState().lang);
    if (mine !== session) return;
    const keys = new Set(inventory.skins.map((s) => s.key));
    const known = new Set(categoriesOf(inventory).map((c) => c.id));
    const s = getState();
    // Отметка типа, которого в новом инвентаре нет, снять нечем: флажка для неё не нарисовано, а сетка пуста.
    const categories = s.filter.categories.filter((id) => known.has(id));
    setState({
      inventory,
      loading: false,
      selected: s.selected.filter((k) => keys.has(k)),
      // Без лишних отметок объект фильтра остаётся прежним: сетка не пересоздаётся и не прокручивается в начало.
      filter: categories.length === s.filter.categories.length ? s.filter : { ...s.filter, categories },
      panel: s.panel.kind === 'running' ? s.panel : { kind: 'selection' },
    });
  } catch (e) {
    if (mine !== session) return;
    setState({ loading: false });
    showError(asUiError(e));
  }
}

export function setFilter(patch: Partial<Filter>): void {
  setState({ filter: { ...getState().filter, ...patch } });
}

/** Выбор меняет панель на «выбор», кроме времени, когда идёт операция. */
export function selectSkin(key: string, mode: SelectMode, order: string[]): void {
  const s = getState();
  const next = nextSelection({ selected: s.selected, anchor: s.anchor }, key, mode, order);
  setState({ ...next, panel: s.panel.kind === 'running' ? s.panel : { kind: 'selection' } });
}

export function clearSelection(): void {
  setState({ selected: [], anchor: null });
}

export function closePanel(): void {
  if (getState().panel.kind !== 'running') setState({ panel: { kind: 'selection' } });
}

export async function showPlan(operation: Operation): Promise<void> {
  if (getState().panel.kind === 'running') return;
  const mine = session;
  try {
    const plan = await api.preview(operation);
    if (mine !== session) return;
    setState({ panel: { kind: 'plan', plan, changed: false } });
  } catch (e) {
    if (mine !== session) return;
    showError(asUiError(e));
  }
}

export async function runPlan(plan: Plan): Promise<void> {
  if (getState().panel.kind === 'running') return;
  const mine = session;
  setState({ panel: running(plan), error: null });
  let unlisten: (() => void) | null = null;
  try {
    unlisten = await api.onProgress((progress) => {
      if (mine === session) onProgress(progress);
    });
    if (mine !== session) return;
    const result = await api.start(plan.operation, getState().lang);
    if (mine !== session) return;
    if (result.kind === 'planChanged') {
      setState({ inventory: result.inventory, panel: { kind: 'plan', plan: result.plan, changed: true } });
    } else {
      setState({
        inventory: result.inventory ?? getState().inventory,
        panel: { kind: 'result', plan, outcome: result.outcome, reconciliation: result.reconciliation },
        tokenExpired: result.outcome.reason === 'tokenRejected',
      });
    }
  } catch (e) {
    if (mine !== session) return;
    setState({ panel: { kind: 'selection' } });
    showError(asUiError(e));
  } finally {
    unlisten?.();
  }
}

function running(plan: Plan): Panel {
  return { kind: 'running', plan, done: 0, total: plan.requests, errors: 0, key: '', waitUntil: null, stopping: false };
}

function onProgress(progress: Progress): void {
  const panel = getState().panel;
  if (panel.kind !== 'running') return;
  if (progress.kind === 'request') {
    const { done, total, errors, key } = progress;
    setState({ panel: { ...panel, done, total, errors, key, waitUntil: null } });
  } else {
    setState({ panel: { ...panel, waitUntil: Date.now() + progress.seconds * 1000 } });
  }
}

export function stopRun(): void {
  const panel = getState().panel;
  if (panel.kind !== 'running' || panel.stopping) return;
  const mine = session;
  setState({ panel: { ...panel, stopping: true } });
  api.stop().catch((e: unknown) => {
    if (mine !== session) return;
    const now = getState().panel;
    if (now.kind === 'running') setState({ panel: { ...now, stopping: false } });
    showError(asUiError(e));
  });
}

/**
 * Назад на экран входа: «Забыть токен» и «Вставить токен». Не отклоняется: окно сбрасывается всегда,
 * а ошибка ядра остаётся в `error` и показывается в строке состояния экрана входа.
 */
export async function forgetToken(): Promise<void> {
  session += 1;
  let failure: UiError | null = null;
  try {
    await api.forgetToken();
  } catch (e) {
    failure = asUiError(e);
  }
  setState({
    screen: 'login',
    token: null,
    inventory: null,
    loading: false,
    selected: [],
    anchor: null,
    panel: { kind: 'selection' },
    tokenExpired: false,
    error: failure,
    menuOpen: false,
    settingsOpen: false,
  });
}

export async function copyJournal(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(await api.journal());
    return true;
  } catch {
    return false;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const saved = await api.saveSettings(settings);
  const lang: Lang = saved.language ?? detectLang(navigator.language);
  setLang(lang);
  setState({ settings: saved, lang, settingsOpen: false });
}

/** Не отклоняется: ошибку возвращает (язык не меняется), на главном экране ещё и показывает плашкой. */
export async function switchLang(lang: Lang): Promise<UiError | null> {
  try {
    await saveSettings({ ...getState().settings, language: lang });
    return null;
  } catch (e) {
    const error = asUiError(e);
    if (getState().screen === 'main') showError(error);
    return error;
  }
}
