// Действия окна: всё, что меняет состояние и вызывает ядро.

import { api, asUiError } from './api';
import { detectLang, setLang, type Lang } from './i18n';
import { categoriesOf, nextSelection, totals, visibleSkins, type Filter, type SelectMode } from './model';
import { getState, setState, type Panel, type State } from './store';
import type { Inventory, Operation, Plan, Progress, Settings, TokenInfo, UiError } from './types';

const TOKEN_CODES = new Set(['tokenExpired', 'tokenRejected', 'noToken']);

// Номер сессии токена: растёт в «Забыть токен» и при входе с новым токеном. Ответ, начатый в прошлой сессии,
// в окно не попадает: ни инвентарь, ни ошибка (например, noToken чтения, оборванного новым токеном).
let session = 0;

// Язык сменили во время запуска: инвентарь перечитается на новом языке, когда придёт результат.
let rereadAfterRun = false;

/** Ошибка токена — плашка «Токен истёк», любая другая — плашка с текстом ошибки. */
function showError(error: UiError): void {
  if (TOKEN_CODES.has(error.code)) setState({ tokenExpired: true, error: null });
  else setState({ error });
}

/**
 * Новый инвентарь и то, что от него зависит. Из выбора, якоря и отметок типов уходят исчезнувшие ключи и типы.
 * Если «Показать» оставляет сетку пустой, хотя предметы есть (после «Разделить всё» при «Стопках»), — снова «Все»:
 * иначе кажется, что предметы пропали. Неизменившиеся массив выбора и объект фильтра остаются теми же.
 */
export function adoptInventory(inventory: Inventory): Pick<State, 'inventory' | 'selected' | 'anchor' | 'filter'> {
  const s = getState();
  const keys = new Set(inventory.skins.map((skin) => skin.key));
  const known = new Set(categoriesOf(inventory).map((c) => c.id));
  const selected = s.selected.every((k) => keys.has(k)) ? s.selected : s.selected.filter((k) => keys.has(k));
  const anchor = s.anchor !== null && keys.has(s.anchor) ? s.anchor : null;
  let filter: Filter = s.filter;
  // Отметка типа, которого в новом инвентаре нет, снять нечем: флажка для неё не нарисовано, а сетка пуста.
  const categories = filter.categories.filter((id) => known.has(id));
  if (categories.length !== filter.categories.length) filter = { ...filter, categories };
  if (filter.show !== 'all' && inventory.skins.length > 0 && visibleSkins(inventory, filter).length === 0) {
    filter = { ...filter, show: 'all' };
  }
  return { inventory, selected, anchor, filter };
}

/** `keepPanel` — не закрывать открытый вид (перечитывание после смены языка). Иначе панель возвращается к выбору. */
export async function loadInventory(options: { keepPanel?: boolean } = {}): Promise<void> {
  const mine = session;
  setState({ loading: true, error: null });
  try {
    const inventory = await api.loadInventory(getState().lang);
    if (mine !== session) return;
    const panel = getState().panel;
    setState({
      ...adoptInventory(inventory),
      loading: false,
      panel: panel.kind === 'running' || options.keepPanel ? panel : { kind: 'selection' },
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
  let first = true;
  try {
    unlisten = await api.onProgress((progress) => {
      if (mine !== session) return;
      const resend = first;
      first = false;
      onProgress(progress);
      // «Остановить», нажатая, пока start шёл к ядру, стёрта началом запуска. Первое событие значит, что запуск
      // в ядре начался: повторяем просьбу один раз, и она сработает после текущего запроса.
      const panel = getState().panel;
      if (resend && panel.kind === 'running' && panel.stopping) sendStop(mine);
    });
    if (mine !== session) return;
    const result = await api.start(plan.operation, getState().lang);
    if (mine !== session) return;
    if (result.kind === 'planChanged') {
      setState({ ...adoptInventory(result.inventory), panel: { kind: 'plan', plan: result.plan, changed: true } });
    } else {
      const fresh = result.inventory;
      setState({
        ...(fresh ? adoptInventory(fresh) : {}),
        panel: {
          kind: 'result',
          plan,
          outcome: result.outcome,
          reconciliation: result.reconciliation,
          stacks: fresh ? totals(fresh).stacks : null,
        },
        tokenExpired: result.outcome.reason === 'tokenRejected',
      });
    }
    afterRun();
  } catch (e) {
    if (mine !== session) return;
    setState({ panel: { kind: 'selection' } });
    showError(asUiError(e));
    afterRun();
  } finally {
    unlisten?.();
  }
}

function running(plan: Plan): Panel {
  return { kind: 'running', plan, done: 0, total: plan.requests, errors: 0, key: '', processed: [], waitUntil: null, stopping: false };
}

/**
 * Ключ сменился с A на B — шаги A прошли, A обработан. Последнее событие приходит с пустым ключом и делает
 * обработанным последний скин. Ничего не добавилось — тот же массив: сетка не пересчитывает отметки зря.
 */
function processedAfter(processed: string[], was: string, key: string): string[] {
  return was && was !== key && !processed.includes(was) ? [...processed, was] : processed;
}

function onProgress(progress: Progress): void {
  const panel = getState().panel;
  if (panel.kind !== 'running') return;
  if (progress.kind === 'request') {
    const { done, total, errors, key } = progress;
    const processed = processedAfter(panel.processed, panel.key, key);
    setState({ panel: { ...panel, done, total, errors, key, processed, waitUntil: null } });
  } else {
    setState({ panel: { ...panel, waitUntil: Date.now() + progress.seconds * 1000 } });
  }
}

/** Просит ядро остановиться. Не вышло — «Остановить» снова доступна, ошибка видна. */
function sendStop(mine: number): void {
  api.stop().catch((e: unknown) => {
    if (mine !== session) return;
    const now = getState().panel;
    if (now.kind === 'running') setState({ panel: { ...now, stopping: false } });
    showError(asUiError(e));
  });
}

export function stopRun(): void {
  const panel = getState().panel;
  if (panel.kind !== 'running' || panel.stopping) return;
  setState({ panel: { ...panel, stopping: true } });
  sendStop(session);
}

/** Результат запуска показан: если язык сменили во время запуска, теперь перечитываем инвентарь. */
function afterRun(): void {
  if (!rereadAfterRun) return;
  rereadAfterRun = false;
  rereadForLanguage();
}

/**
 * Названия скинов и типов Steam присылает на языке чтения. После смены языка инвентарь перечитывается,
 * открытый вид остаётся; во время запуска — после результата. Без инвентаря и с отклонённым токеном читать нечего.
 */
function rereadForLanguage(): void {
  const s = getState();
  if (s.screen !== 'main' || !s.inventory || s.tokenExpired) return;
  if (s.panel.kind === 'running') rereadAfterRun = true;
  else
    void loadInventory({ keepPanel: true }).then(() => {
      // Чтение сбросило план в ядре: открытый план запрашиваем заново, иначе «Запустить» скажет «инвентарь изменился».
      const panel = getState().panel;
      if (panel.kind === 'plan') void showPlan(panel.plan.operation);
    });
}

/**
 * Вход с проверенным токеном. Начинает новую сессию: поздний ответ прошлой — например, noToken чтения,
 * которое ядро оборвало, когда вставили новый токен, — не вернёт окно к плашке «Токен истёк».
 */
export function signIn(token: TokenInfo): void {
  session += 1;
  rereadAfterRun = false;
  setState({
    screen: 'main',
    token,
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
}

/**
 * Назад на экран входа: «Забыть токен» и «Вставить токен». Не отклоняется: окно сбрасывается всегда,
 * а ошибка ядра остаётся в `error` и показывается в строке состояния экрана входа.
 */
export async function forgetToken(): Promise<void> {
  session += 1;
  rereadAfterRun = false;
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
  const relang = lang !== getState().lang;
  setLang(lang);
  setState({ settings: saved, lang, settingsOpen: false });
  if (relang) rereadForLanguage();
}

// Номер последнего сохранения масштаба с клавиш: ответ на более раннее нажатие в окно не попадает.
let scaleSave = 0;

/** Ошибка масштаба (не сохранился, не применился): на главном экране — плашкой, на экране входа — в `error`. */
export function showScaleError(error: UiError): void {
  if (getState().screen === 'main') showError(error);
  else setState({ error });
}

/**
 * Зум или сохранение масштаба прошли: ошибка `zoomFailed` больше не нужна. `before` — ошибка в окне, когда вызов
 * начался: убирается только она. Ошибка, которую показали во время вызова (тем же нажатием клавиши), остаётся.
 */
export function clearScaleError(before: UiError | null): void {
  const error = getState().error;
  if (error && error === before && error.code === 'zoomFailed') setState({ error: null });
}

/** Кнопка «Закрыть» на плашке ошибки. */
export function dismissError(): void {
  setState({ error: null });
}

/**
 * Масштаб с клавиш Ctrl+= / Ctrl+− / Ctrl+0 (`0` — «Авто»): сохраняется вместе с остальными настройками,
 * панель настроек не закрывается, язык не перечитывается. Не отклоняется: ошибку показывает `showScaleError`.
 * Масштаб окна при этом не откатывается.
 */
export async function setUiScale(uiScale: number): Promise<void> {
  const mine = ++scaleSave;
  const before = getState().error;
  try {
    const saved = await api.saveSettings({ ...getState().settings, uiScale });
    if (mine !== scaleSave) return;
    setState({ settings: saved });
    clearScaleError(before);
  } catch (e) {
    if (mine === scaleSave) showScaleError(asUiError(e));
  }
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
