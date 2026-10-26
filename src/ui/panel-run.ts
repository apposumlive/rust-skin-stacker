// Правая панель вокруг операции: план, ход, итог со сверкой.

import { closePanel, copyJournal, loadInventory, runPlan, stopRun } from '../actions';
import { h, icon } from '../dom';
import { estimateSeconds, fmtDuration, fmtInt } from '../format';
import { t, tn } from '../i18n';
import { totals } from '../model';
import type { Panel, State } from '../store';
import type { Operation, Plan, Skin } from '../types';
import { picture } from './panel-select';

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
    return h(
      'div',
      { class: 'panel plan' },
      h('h2', { class: 'plan-h' }, title(operation)),
      h('p', { class: 'note ok' }, icon('circle-check'), t(isSplit(operation) ? 'plan.nothingSplit' : 'plan.nothingCombine')),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn sec wide', type: 'button', onclick: closePanel }, t('plan.close')),
    );
  }
  const byKey = skinsByKey(state);
  const sub = operation.kind === 'splitOff' ? t('op.splitOff.sub', { count: fmtInt(plan.requests) }) : t(`op.${operation.kind}.sub`);
  const items = state.inventory ? totals(state.inventory).items : 0;
  return h(
    'div',
    { class: 'panel plan' },
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
    h('div', { class: 'grow' }),
    h('button', { class: 'btn pri run', type: 'button', onclick: () => void runPlan(plan) }, icon('player-play'), t('plan.run')),
    h('button', { class: 'btn sec cancel', type: 'button', onclick: closePanel }, t('plan.cancel')),
  );
}

export function runningView(
  panel: Extract<Panel, { kind: 'running' }>,
  state: State,
  tick: (fn: () => void) => void,
): HTMLElement {
  const name = panel.key ? (skinsByKey(state).get(panel.key)?.name ?? panel.key) : '';
  const fill = h('div', { class: 'fill' });
  fill.style.width = `${panel.total ? Math.round((panel.done / panel.total) * 100) : 100}%`;
  const wait = h('p', { class: 'wait num', role: 'status' });
  if (panel.waitUntil) {
    const until = panel.waitUntil;
    const show = () => {
      wait.textContent = t('run.waiting', { seconds: Math.max(0, Math.ceil((until - Date.now()) / 1000)) });
    };
    show();
    tick(show);
  } else {
    wait.hidden = true;
  }
  const left = Math.max(0, panel.total - panel.done);
  return h(
    'div',
    { class: 'panel run-view' },
    h('h2', { class: 'plan-h' }, t('run.title', { op: title(panel.plan.operation) })),
    h(
      'div',
      { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': panel.total, 'aria-valuenow': panel.done },
      fill,
    ),
    h('p', { class: 'num' }, t('run.progress', { done: fmtInt(panel.done), total: fmtInt(panel.total), errors: fmtInt(panel.errors) })),
    name ? h('p', { class: 'muted' }, t('run.current', { name })) : null,
    h('p', { class: 'muted num' }, t('run.left', { time: fmtDuration(estimateSeconds(left, state.settings.delayMs)) })),
    wait,
    h('p', { class: 'foot' }, t('run.browse')),
    h(
      'button',
      { class: 'btn danger wide', type: 'button', disabled: panel.stopping, onclick: stopRun },
      icon('player-stop'),
      t(panel.stopping ? 'run.stopping' : 'run.stop'),
    ),
  );
}

export function resultView(panel: Extract<Panel, { kind: 'result' }>): HTMLElement {
  const { outcome, reconciliation } = panel;
  const finished = outcome.reason === 'finished';
  let check: HTMLElement;
  if (!reconciliation) {
    check = h('p', { class: 'verdict bad' }, icon('alert-triangle'), t('result.checkUnavailable'));
  } else if (reconciliation.before === reconciliation.after && reconciliation.mismatches.length === 0) {
    check = h(
      'p',
      { class: 'verdict ok num' },
      icon('scale'),
      t('result.checkOk', { before: fmtInt(reconciliation.before), after: fmtInt(reconciliation.after) }),
    );
  } else {
    check = h(
      'div',
      { class: 'verdict bad' },
      h('p', { class: 'num' }, icon('alert-triangle'), t('result.checkBad', { before: fmtInt(reconciliation.before), after: fmtInt(reconciliation.after) })),
      h(
        'ul',
        { class: 'mismatches num' },
        ...reconciliation.mismatches.map((m) => h('li', {}, t('result.mismatch', { name: m.name, before: fmtInt(m.before), after: fmtInt(m.after) }))),
      ),
    );
  }
  const copyLabel = h('span', {}, t('result.copyLog'));
  const copy = async () => {
    copyLabel.textContent = t((await copyJournal()) ? 'result.copied' : 'menu.copyFailed');
  };
  return h(
    'div',
    { class: 'panel outcome' },
    h('h2', { class: 'plan-h' }, t(finished ? 'result.done' : 'result.stopped')),
    h('p', { class: 'isub num' }, t('result.summary', { requests: tn('plan.requests', outcome.done), errors: fmtInt(outcome.errors) })),
    finished ? null : h('p', { class: 'note' }, icon('alert-triangle'), t(`result.reason.${outcome.reason}`)),
    check,
    h('div', { class: 'grow' }),
    h('button', { class: 'btn pri wide', type: 'button', onclick: () => void loadInventory() }, icon('refresh'), t('result.reload')),
    h(
      'div',
      { class: 'acts' },
      h('button', { class: 'btn sec', type: 'button', onclick: () => void copy() }, icon('clipboard'), copyLabel),
      h('button', { class: 'btn sec', type: 'button', onclick: closePanel }, t('result.close')),
    ),
  );
}
