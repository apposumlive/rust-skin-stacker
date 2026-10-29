// Состояние окна. Один объект, setState заменяет его и оповещает подписчиков.

import type { Lang } from './i18n';
import { defaultFilter, type Filter } from './model';
import type { Inventory, Plan, Reconciliation, RunOutcome, Settings, TokenInfo, UiError } from './types';

export type Panel =
  | { kind: 'selection' }
  | { kind: 'plan'; plan: Plan; changed: boolean }
  | {
      kind: 'running';
      plan: Plan;
      done: number;
      total: number;
      errors: number;
      key: string;
      /** Ключи скинов, чьи шаги уже прошли (успешно или нет), в порядке обработки. */
      processed: string[];
      /** Конец ожидания по 429, `Date.now()`-миллисекунды. */
      waitUntil: number | null;
      stopping: boolean;
    }
  | {
      kind: 'result';
      plan: Plan;
      outcome: RunOutcome;
      reconciliation: Reconciliation | null;
      /** Стопок в инвентаре, прочитанном после запуска; `null` — ядро его не прислало. */
      stacks: number | null;
    };

export interface State {
  screen: 'login' | 'main';
  lang: Lang;
  settings: Settings;
  token: TokenInfo | null;
  inventory: Inventory | null;
  loading: boolean;
  /** Конец ожидания по 429 при чтении без запуска, `Date.now()`-миллисекунды (как `waitUntil` у «Хода»). */
  loadWaitUntil: number | null;
  /** Чтение без запуска: сколько записей прочитано и сколько их всего (`null` — Steam не сказал). `null` — страниц ещё нет. */
  loadProgress: { read: number; total: number | null } | null;
  /** «Остановить» нажата во время чтения: ядро уже просили, ответа ждём. */
  loadStopping: boolean;
  /** Ошибка загрузки или запуска — плашка над сеткой. */
  error: UiError | null;
  tokenExpired: boolean;
  filter: Filter;
  selected: string[];
  anchor: string | null;
  panel: Panel;
  menuOpen: boolean;
  settingsOpen: boolean;
}

export const initialFilter: Filter = defaultFilter();

type Listener = (state: State) => void;

let state: State;
const listeners = new Set<Listener>();

export function initState(initial: State): void {
  state = initial;
}

export function getState(): State {
  return state;
}

export function setState(patch: Partial<State>): void {
  state = { ...state, ...patch };
  for (const listener of [...listeners]) if (listeners.has(listener)) listener(state);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
