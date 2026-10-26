// Верхняя панель: массовые действия, аккаунт и срок токена, язык, меню.

import { copyJournal, forgetToken, showPlan, switchLang } from '../actions';
import { h, icon } from '../dom';
import { fmtTimeLeft } from '../format';
import { getLang, t } from '../i18n';
import { getState, setState, type State } from '../store';
import type { Part } from './shell';

/** Кнопка меню — «хозяин» панели настроек: сюда возвращается фокус, когда запомненного места нет. */
export function focusMenuButton(): void {
  document.querySelector<HTMLElement>('.menu-wrap .icon-btn')?.focus();
}

export function createTopbar(el: HTMLElement): Part {
  const split = h(
    'button',
    { class: 'bulk', type: 'button', onclick: () => void showPlan({ kind: 'splitAll' }) },
    icon('arrows-split-2'),
    t('top.splitAll'),
  );
  const combine = h(
    'button',
    { class: 'bulk', type: 'button', onclick: () => void showPlan({ kind: 'combineAll' }) },
    icon('stack-push'),
    t('top.combineAll'),
  );
  const dot = h('span', { class: 'dot', 'aria-hidden': 'true' });
  const account = h('span', {});
  const lang = getLang();
  const langButton = h(
    'button',
    { class: 'lang', type: 'button', 'aria-label': t('top.lang'), onclick: () => void switchLang(lang === 'ru' ? 'en' : 'ru') },
    lang.toUpperCase(),
  );
  const copyLabel = h('span', {}, t('menu.copyLog'));
  const forget = h(
    'button',
    { type: 'button', role: 'menuitem', class: 'danger', onclick: () => void forgetToken() },
    icon('logout'),
    t('menu.forget'),
  );
  const menu = h(
    'div',
    { class: 'menu', role: 'menu', hidden: true },
    h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        onclick: () => {
          // Меню скроется раньше, чем панель запомнит фокус: пусть он будет на кнопке меню, а не на скрытом пункте.
          menuButton.focus();
          setState({ menuOpen: false, settingsOpen: true });
        },
      },
      icon('settings'),
      t('menu.settings'),
    ),
    h('button', { type: 'button', role: 'menuitem', onclick: () => void copy() }, icon('clipboard'), copyLabel),
    forget,
  );
  const menuButton = h(
    'button',
    {
      class: 'icon-btn',
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-label': t('top.menu'),
      onclick: () => setState({ menuOpen: !getState().menuOpen }),
    },
    icon('dots'),
  );
  const menuWrap = h('div', { class: 'menu-wrap' }, menuButton, menu);
  el.append(
    h('div', { class: 'brand' }, h('span', { class: 'logo' }, icon('stack-2')), t('app.name')),
    split,
    combine,
    h('div', { class: 'acct' }, dot, account),
    langButton,
    menuWrap,
  );

  let copyTimer = 0;
  const copy = async () => {
    const ok = await copyJournal();
    copyLabel.textContent = t(ok ? 'menu.logCopied' : 'menu.copyFailed');
    window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => {
      copyLabel.textContent = t('menu.copyLog');
    }, 1500);
  };

  const paint = (s: State) => {
    const running = s.panel.kind === 'running';
    const open = s.panel.kind === 'plan' ? s.panel.plan.operation.kind : null;
    for (const [button, kind] of [[split, 'splitAll'], [combine, 'combineAll']] as const) {
      button.disabled = running || !s.inventory;
      button.classList.toggle('active', open === kind);
      button.setAttribute('aria-pressed', String(open === kind));
    }
    const now = Date.now() / 1000;
    const id = s.token?.steamidMasked ?? '';
    const expired = s.tokenExpired || !s.token || s.token.expiresAt <= now;
    dot.classList.toggle('bad', expired);
    account.textContent =
      expired || !s.token ? t('top.accountExpired', { id }) : t('top.account', { id, left: fmtTimeLeft(s.token.expiresAt, now) });
    menu.hidden = !s.menuOpen;
    menuButton.setAttribute('aria-expanded', String(s.menuOpen));
    forget.disabled = running;
  };

  const onPointer = (e: MouseEvent) => {
    if (getState().menuOpen && !menuWrap.contains(e.target as Node)) setState({ menuOpen: false });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && getState().menuOpen) {
      setState({ menuOpen: false });
      menuButton.focus();
    }
  };
  document.addEventListener('mousedown', onPointer);
  document.addEventListener('keydown', onKey);
  // Срок токена убывает и без событий.
  const clock = window.setInterval(() => paint(getState()), 60_000);

  return {
    update: paint,
    destroy() {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.clearInterval(clock);
      window.clearTimeout(copyTimer);
    },
  };
}
