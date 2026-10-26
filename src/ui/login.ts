// Экран входа: как получить токен, поле вставки с проверкой на лету, почему это безопасно.

import { switchLang } from '../actions';
import { api, asUiError } from '../api';
import { h, icon } from '../dom';
import { fmtTimeLeft } from '../format';
import { errorText, getLang, t } from '../i18n';
import { setState } from '../store';
import type { TokenInfo } from '../types';

export interface Screen {
  el: HTMLElement;
  destroy(): void;
}

export function renderLogin(): Screen {
  const status = h('p', { class: 'login-status', role: 'status', 'aria-live': 'polite' });
  const next = h('button', { class: 'btn pri', type: 'button', disabled: true }, t('login.continue'), icon('arrow-right'));
  const field = h('textarea', {
    class: 'login-field',
    rows: 5,
    placeholder: t('login.placeholder'),
    'aria-label': t('login.placeholder'),
    spellcheck: 'false',
    autocomplete: 'off',
  });
  let info: TokenInfo | null = null;
  let timer = 0;
  let seq = 0;

  // Каждая вставка проверяется в ядре; ответ на устаревший ввод отбрасывается.
  const check = async () => {
    const raw = field.value.trim();
    const mine = ++seq;
    info = null;
    next.disabled = true;
    status.className = 'login-status';
    status.textContent = raw ? t('login.checking') : '';
    if (!raw) return;
    try {
      const result = await api.setToken(raw);
      if (mine !== seq) return;
      info = result;
      status.textContent = t('login.ok', {
        id: result.steamidMasked,
        left: fmtTimeLeft(result.expiresAt, Date.now() / 1000),
      });
      status.classList.add('ok');
      next.disabled = false;
    } catch (e) {
      if (mine !== seq) return;
      status.textContent = errorText(asUiError(e));
      status.classList.add('bad');
    }
  };

  field.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void check(), 250);
  });
  next.addEventListener('click', () => {
    if (!info) return;
    field.value = '';
    setState({ screen: 'main', token: info, tokenExpired: false, error: null });
  });

  const lang = getLang();
  const el = h(
    'main',
    { class: 'login' },
    h(
      'div',
      { class: 'login-card' },
      h(
        'div',
        { class: 'login-head' },
        h('div', { class: 'brand' }, h('span', { class: 'logo' }, icon('stack-2')), t('app.name')),
        h(
          'button',
          { class: 'lang', type: 'button', 'aria-label': t('top.lang'), onclick: () => void switchLang(lang === 'ru' ? 'en' : 'ru') },
          lang.toUpperCase(),
        ),
      ),
      h('h1', { class: 'login-title' }, t('login.title')),
      h('p', { class: 'muted' }, t('login.lead')),
      h('ol', { class: 'steps' }, h('li', {}, t('login.step1')), h('li', {}, t('login.step2')), h('li', {}, t('login.step3'))),
      h('button', { class: 'btn sec', type: 'button', onclick: () => void api.openTokenPage() }, icon('external-link'), t('login.open')),
      field,
      status,
      next,
      h(
        'section',
        { class: 'safe' },
        h('h2', {}, icon('shield-check'), t('login.safeTitle')),
        h('ul', {}, h('li', {}, t('login.safe1')), h('li', {}, t('login.safe2')), h('li', {}, t('login.safe3'))),
      ),
      h('p', { class: 'disclaimer' }, t('app.disclaimer')),
    ),
  );
  return { el, destroy: () => window.clearTimeout(timer) };
}
