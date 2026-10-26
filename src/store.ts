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
      /** Конец ожидания по 429, `Date.now()`-миллисекунды. */
      waitUntil: number | null;
      stopping: boolean;
    }
  | { kind: 'result'; plan: Plan; outcome: RunOutcome; reconciliation: Reconciliation | null };

export interface State {
  screen: 'login' | 'main';
  lang: Lang;
  settings: Settings;
  token: TokenInfo | null;
  inventory: Inventory | null;
  loading: boolean;
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
