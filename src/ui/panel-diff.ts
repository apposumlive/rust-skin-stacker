// Что делать правой панели с новым состоянием: оставить, поправить на месте или собрать заново.
// Ход операции приходит каждые полсекунды и дольше. Пересборка на каждый шаг роняла бы фокус с «Остановить»,
// теряла клик, если между нажатием и отпусканием пришло обновление, и заново проигрывала появление панели.

import type { Panel, State } from '../store';
import type { Inventory } from '../types';

/** Всё, от чего зависит вид панели. Сравнивается по ссылкам. */
export interface Shown {
  panel: Panel;
  selected: string[];
  inventory: Inventory | null;
  delay: number;
  loading: boolean;
  loadWaitUntil: number | null;
  loadProgress: State['loadProgress'];
  loadStopping: boolean;
}

export type PanelStep = 'keep' | 'patch' | 'rebuild';

export function shownOf(state: State): Shown {
  return {
    panel: state.panel,
    selected: state.selected,
    inventory: state.inventory,
    delay: state.settings.delayMs,
    loading: state.loading,
    loadWaitUntil: state.loadWaitUntil,
    loadProgress: state.loadProgress,
    loadStopping: state.loadStopping,
  };
}

/**
 * Чтение без запуска: правая панель показывает вид «Загрузка», а не выбор, план или итог. Во время запуска чтение
 * (перед ним и после него) идёт внутри «Хода» и своего вида не имеет.
 */
export const showsLoad = (s: { loading: boolean; panel: Panel }): boolean => s.loading && s.panel.kind !== 'running';

export function panelStep(prev: Shown | null, next: Shown): PanelStep {
  if (!prev) return 'rebuild';
  // Ход одной и той же операции: вид читает только panel, inventory (название предмета) и delay (оценка времени).
  // Выбор и флаг загрузки его не касаются, а пока идёт запуск, сетку листают и выбирают.
  if (prev.panel.kind === 'running' && next.panel.kind === 'running' && prev.panel.plan === next.panel.plan && prev.inventory && next.inventory) {
    return prev.panel === next.panel && prev.inventory === next.inventory && prev.delay === next.delay ? 'keep' : 'patch';
  }
  // Чтение без запуска: вид читает только ожидание, прочитанное и «Остановить»; выбор, панель и инвентарь под ним не видны.
  if (showsLoad(prev) && showsLoad(next)) {
    const same = prev.loadWaitUntil === next.loadWaitUntil && prev.loadProgress === next.loadProgress && prev.loadStopping === next.loadStopping;
    return same ? 'keep' : 'patch';
  }
  return (Object.keys(next) as (keyof Shown)[]).every((k) => prev[k] === next[k]) ? 'keep' : 'rebuild';
}

/** Появление панели играет, только когда на её месте стал другой вид, а не когда тот же вид обновился. */
export function entering(prev: Shown | null, next: Shown): boolean {
  return !prev || prev.panel.kind !== next.panel.kind || !prev.inventory !== !next.inventory || showsLoad(prev) !== showsLoad(next);
}

/** Где был фокус, когда вид панели собирался заново: в панели, потерян (на <body>) или в другом месте окна. */
export type FocusPlace = 'panel' | 'lost' | 'elsewhere';

export function focusPlace(active: Element | null, panel: Element, body: Element | null): FocusPlace {
  if (!active || active === body) return 'lost';
  return panel.contains(active) ? 'panel' : 'elsewhere';
}

/**
 * Переводить ли фокус на главный элемент нового вида. Старый вид удалён вместе с кнопкой, которую нажали
 * («Запустить», «Отмена», «Закрыть»), и фокус упал бы на <body>. Фокус в сетке или поиске не трогаем.
 */
export const takesFocus = (place: FocusPlace): boolean => place !== 'elsewhere';

/**
 * Глотать ли нажатие в панели: Enter и пробел с автоповтором. Панель переводит фокус на главный элемент нового вида,
 * и удержанный Enter на «Отделить N» иначе нажал бы «Запустить» невидимо для человека, а следующий повтор — «Остановить».
 * Первое нажатие проходит как обычно; стрелки (ползунок) повторяются.
 */
export const swallowsKey = (key: string, repeat: boolean): boolean => repeat && (key === 'Enter' || key === ' ');
