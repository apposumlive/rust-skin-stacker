// Данные из Rust-ядра (serde, camelCase). Меняются вместе с src-tauri/src.

export interface TokenInfo {
  steamidMasked: string;
  expiresAt: number;
}

export interface Category {
  id: string;
  label: string;
}

export interface InvRecord {
  assetid: string;
  classid: string;
  instanceid: string;
  amount: number;
  tradable: boolean;
  marketable: boolean;
  availableAfter: string | null;
}

export interface Skin {
  key: string;
  name: string;
  icon: string | null;
  category: Category | null;
  total: number;
  /** По убыванию amount. */
  records: InvRecord[];
}

export interface Unreadable {
  assetid: string | null;
  amount: number;
}

export interface Inventory {
  skins: Skin[];
  unreadable: Unreadable[];
}

export type Operation =
  | { kind: 'splitAll' }
  | { kind: 'combineAll' }
  | { kind: 'splitSelected'; keys: string[] }
  | { kind: 'combineSelected'; keys: string[] }
  | { kind: 'splitOff'; key: string; count: number };

export interface QueueItem {
  key: string;
  amount: number;
  requests: number;
}

export interface SkinAfter {
  key: string;
  stacks: number[];
  singles: number;
}

export interface Plan {
  operation: Operation;
  requests: number;
  stacks: number;
  queue: QueueItem[];
  more: number;
  after: SkinAfter[];
}

export type Progress =
  | { kind: 'request'; done: number; total: number; errors: number; key: string }
  | { kind: 'waiting'; seconds: number };

export type StopReason = 'finished' | 'stoppedByUser' | 'tokenRejected' | 'tooManyFailures';

export interface RunOutcome {
  reason: StopReason;
  done: number;
  errors: number;
  total: number;
}

export interface Mismatch {
  key: string;
  name: string;
  before: number;
  after: number;
}

export interface Reconciliation {
  before: number;
  after: number;
  mismatches: Mismatch[];
}

export type StartResult =
  | { kind: 'planChanged'; plan: Plan; inventory: Inventory }
  | { kind: 'finished'; outcome: RunOutcome; reconciliation: Reconciliation | null; inventory: Inventory | null };

export interface Settings {
  language: 'en' | 'ru' | null;
  delayMs: number;
}

export interface UiError {
  code: string;
  status: number | null;
}
