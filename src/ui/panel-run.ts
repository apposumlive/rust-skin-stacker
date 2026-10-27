// Правая панель вокруг операции: план, ход, итог со сверкой.

import { closePanel, copyJournal, forgetToken, loadInventory, runPlan, stopRun } from '../actions';
import { h, icon } from '../dom';
import { estimateSeconds, fmtDuration, fmtInt, remainingSeconds } from '../format';
import { t, tn } from '../i18n';
import { totals } from '../model';
import type { Panel, State } from '../store';
import type { Operation, Plan, Skin } from '../types';
import { mainHeading, panelView, picture } from './panel-select';

function title(operation: Operation): string {
  return operation.kind === 'splitOff' ? t('op.splitOff', { count: fmtInt(operation.count) }) : t(`op.${operation.kind}`);
}

const isSplit = (operation: Operation) => operation.kind !== 'combineAll' && operation.kind !== 'combineSelected';

function skinsByKey(state: State): Map<string, Skin> {
  return new Map((state.inventory?.skins ?? []).map((skin) => [skin.key, skin]));
}

function fact(label: string, value: string): HTMLElement {
  return h('div', { class: 'fact' }, h('dt', {}, label), h('dd', { class: 'num' }, value));
}

export function planView(plan: Plan, changed: boolean, state: State): HTMLElement {
  const operation = plan.operation;
  if (plan.requests === 0) {
    return panelView(
      'plan',
      [
        h('h2', { class: 'plan-h' }, title(operation)),
        changed ? h('p', { class: 'note' }, icon('refresh'), t('plan.changed')) : null,
        h('p', { class: 'note ok' }, icon('circle-check'), t(isSplit(operation) ? 'plan.nothingSplit' : 'plan.nothingCombine')),
      ],
      [h('button', { class: 'btn sec wide', type: 'button', 'data-main': true, onclick: closePanel }, t('plan.close'))],
    );
  }
  const byKey = skinsByKey(state);
  const sub = operation.kind === 'splitOff' ? t('op.splitOff.sub', { count: fmtInt(plan.requests) }) : t(`op.${operation.kind}.sub`);
  const items = state.inventory ? totals(state.inventory).items : 0;
  return panelView(
    'plan',
    [
      h('h2', { class: 'plan-h' }, title(operation)),
      h('p', { class: 'isub' }, sub),
      changed ? h('p', { class: 'note' }, icon('refresh'), t('plan.changed')) : null,
      h(
        'dl',
        { class: 'facts' },
        fact(t('plan.stacks'), fmtInt(plan.stacks)),
        fact(t('plan.requestsLabel'), fmtInt(plan.requests)),
        fact(t('plan.time'), fmtDuration(estimateSeconds(plan.requests, state.settings.delayMs))),
      ),
      h('div', { class: 'fh queue-h' }, t('plan.queue')),
      h(
        'ul',
        { class: 'queue' },
        ...plan.queue.map((item) => {
          const skin = byKey.get(item.key);
          return h(
            'li',
            {},
            picture(skin, 64, 'qimg'),
            h('span', { class: 'qn' }, `${skin?.name ?? item.key} ×${fmtInt(item.amount)}`),
            h('span', { class: 'r num' }, t('plan.queueReq', { count: fmtInt(item.requests) })),
          );
        }),
        plan.more ? h('li', { class: 'more' }, tn('plan.more', plan.more)) : null,
      ),
      h('p', { class: 'check' }, icon('scale'), t('plan.check', { count: fmtInt(items) })),
    ],
    [
      h('button', { class: 'btn pri run', type: 'button', 'data-main': true, onclick: () => void runPlan(plan) }, icon('player-play'), t('plan.run')),
      h('button', { class: 'btn sec cancel', type: 'button', onclick: closePanel }, t('plan.cancel')),
    ],
  );
}

type Running = Extract<Panel, { kind: 'running' }>;

/** Части вида «Ход», которые меняются по ходу операции. Сами узлы живут всё время запуска. */
interface RunningParts {
  bar: HTMLElement;
  fill: HTMLElement;
  progress: HTMLElement;
  current: HTMLElement;
  left: HTMLElement;
  wait: HTMLElement;
  stop: HTMLButtonElement;
  stopLabel: HTMLElement;
}

const runningParts = new WeakMap<HTMLElement, RunningParts>();

/** Строка «Steam попросил подождать»: считает секунды раз в секунду и прячется, когда ожидание кончилось. */
function paintWait(wait: HTMLElement, until: number | null, tick: (fn: () => void) => void): void {
  if (until === null) {
    wait.hidden = true;
    wait.textContent = '';
    return;
  }
  const show = () => {
    const seconds = remainingSeconds(until, Date.now());
    wait.hidden = seconds <= 0;
    wait.textContent = seconds > 0 ? t('run.waiting', { seconds: fmtInt(seconds) }) : '';
  };
  show();
  tick(show);
}

function paintRunning(parts: RunningParts, panel: Running, state: State, tick: (fn: () => void) => void): void {
  const name = panel.key ? (skinsByKey(state).get(panel.key)?.name ?? panel.key) : '';
  const left = Math.max(0, panel.total - panel.done);
  parts.fill.style.width = `${panel.total ? Math.round((panel.done / panel.total) * 100) : 100}%`;
  parts.bar.setAttribute('aria-valuemax', String(panel.total));
  parts.bar.setAttribute('aria-valuenow', String(panel.done));
  parts.progress.textContent = t('run.progress', { done: fmtInt(panel.done), total: fmtInt(panel.total), errors: fmtInt(panel.errors) });
  parts.current.hidden = !name;
  parts.current.textContent = name ? t('run.current', { name }) : '';
  parts.left.textContent = t('run.left', { time: fmtDuration(estimateSeconds(left, state.settings.delayMs)) });
  parts.stop.disabled = panel.stopping;
  parts.stopLabel.textContent = t(panel.stopping ? 'run.stopping' : 'run.stop');
  paintWait(parts.wait, panel.waitUntil, tick);
}

export function runningView(panel: Running, state: State, tick: (fn: () => void) => void): HTMLElement {
  const heading = t('run.title', { op: title(panel.plan.operation) });
  const fill = h('div', { class: 'fill' });
  // Чтец экрана называет полосу так же, как заголовок: «Идёт: Разделить всё».
  const bar = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-label': heading }, fill);
  const progress = h('p', { class: 'num' });
  const current = h('p', { class: 'muted' });
  const left = h('p', { class: 'muted num' });
  const wait = h('p', { class: 'wait num', role: 'status' });
  const stopLabel = h('span', {});
  // Фокус после «Запустить» — на заголовок, не на «Остановить»: случайный второй Enter или пробел остановил бы запуск.
  // «Остановить» — обычная кнопка, до неё доходят по Tab.
  const stop = h('button', { class: 'btn danger wide', type: 'button', onclick: stopRun }, icon('player-stop'), stopLabel);
  const el = panelView(
    'run-view',
    [mainHeading('plan-h', heading), bar, progress, current, left, wait, h('p', { class: 'foot' }, t('run.browse'))],
    [stop],
  );
  const parts: RunningParts = { bar, fill, progress, current, left, wait, stop, stopLabel };
  runningParts.set(el, parts);
  paintRunning(parts, panel, state, tick);
  return el;
}

/**
 * Обновляет вид «Ход» на месте: узлы, в том числе «Остановить», остаются теми же, поэтому фокус и клик не теряются.
 * `false` — это не вид «Ход», его надо собрать заново.
 */
export function patchRunning(el: HTMLElement, panel: Running, state: State, tick: (fn: () => void) => void): boolean {
  const parts = runningParts.get(el);
  if (!parts) return false;
  paintRunning(parts, panel, state, tick);
  return true;
}

type Result = Extract<Panel, { kind: 'result' }>;

/** Вердикт сверки. «Сошлось» — только когда сверка есть, суммы равны и расхождений по скинам нет. */
function verdict(panel: Result): HTMLElement {
  const { outcome, reconciliation } = panel;
  if (!reconciliation) {
    const text = outcome.reason === 'tokenRejected' ? 'result.checkTokenRejected' : 'result.checkUnavailable';
    return h('p', { class: 'verdict bad' }, icon('alert-triangle'), t(text));
  }
  if (reconciliation.before === reconciliation.after && reconciliation.mismatches.length === 0) {
    return h('p', { class: 'verdict ok' }, icon('scale'), t('result.checkOk'));
  }
  return h(
    'div',
    { class: 'verdict bad' },
    h('p', {}, icon('alert-triangle'), t('result.checkBad')),
    h(
      'ul',
      { class: 'mismatches num' },
      ...reconciliation.mismatches.map((m) => h('li', {}, t('result.mismatch', { name: m.name, before: fmtInt(m.before), after: fmtInt(m.after) }))),
    ),
  );
}

export function resultView(panel: Result): HTMLElement {
  const { outcome, reconciliation, stacks } = panel;
  const finished = outcome.reason === 'finished';
  const rejected = outcome.reason === 'tokenRejected';

  const copyLabel = h('span', {}, t('result.copyLog'));
  const copy = async () => {
    copyLabel.textContent = t((await copyJournal()) ? 'result.copied' : 'menu.copyFailed');
  };
  const button = (main: boolean, content: Array<Node | string>, onclick: () => void) =>
    h('button', { class: main ? 'btn pri' : 'btn sec', type: 'button', onclick }, ...content);
  // Главная кнопка — то, что разумно сделать дальше: токен отклонён — вставить новый; сверка есть — закрыть;
  // сверки нет — перечитать инвентарь, чтобы она стала возможна.
  const close = (main: boolean) => button(main, [t('result.close')], closePanel);
  const reload = (main: boolean) => button(main, [icon('refresh'), t('result.reload')], () => void loadInventory());
  const copyLog = button(false, [icon('clipboard'), copyLabel], () => void copy());
  const buttons = rejected
    ? [button(true, [icon('key'), t('result.newToken')], () => void forgetToken()), copyLog, close(false)]
    : reconciliation
      ? [close(true), reload(false), copyLog]
      : [reload(true), copyLog, close(false)];

  return panelView(
    'outcome',
    [
      mainHeading('plan-h', t(finished ? 'result.done' : 'result.stopped')),
      h('p', { class: 'isub' }, title(panel.plan.operation)),
      finished ? null : h('p', { class: 'note' }, icon('alert-triangle'), t(`result.reason.${outcome.reason}`)),
      verdict(panel),
      // Только то, что известно точно: нет данных — нет строки.
      h(
        'dl',
        { class: 'facts' },
        fact(t('result.requests'), t('result.requestsValue', { done: fmtInt(outcome.done), total: fmtInt(outcome.total) })),
        fact(t('result.errors'), fmtInt(outcome.errors)),
        reconciliation
          ? fact(t('result.pieces'), t('result.piecesValue', { before: fmtInt(reconciliation.before), after: fmtInt(reconciliation.after) }))
          : null,
        stacks !== null ? fact(t('result.stacksNow'), fmtInt(stacks)) : null,
      ),
    ],
    [h('div', { class: 'acts one' }, ...buttons)],
  );
}
