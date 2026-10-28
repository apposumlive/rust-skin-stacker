// Экран входа: как получить токен, поле вставки с проверкой на лету, почему это безопасно.

import { signIn, switchLang } from '../actions';
import { TOKEN_PAGE, api, asUiError } from '../api';
import { h, icon } from '../dom';
import { fmtTimeLeft } from '../format';
import { errorText, getLang, t } from '../i18n';
import { getState, subscribe } from '../store';
import type { TokenInfo, UiError } from '../types';

export interface Screen {
  el: HTMLElement;
  destroy(): void;
}

/**
 * Текст ошибки на экране входа. `busy` здесь значит, что окно перезагрузили посреди операции: ядро забыло токен
 * и закончит текущий запрос, а до тех пор новый токен не примет. Общее «Операция уже идёт» тут непонятно.
 */
export function loginErrorText(error: UiError): string {
  return error.code === 'busy' ? t('login.busy') : errorText(error);
}

export function renderLogin(): Screen {
  const status = h('p', { class: 'login-status', role: 'status', 'aria-live': 'polite' });
  const next = h('button', { class: 'btn pri', type: 'button', disabled: true }, t('login.continue'), icon('arrow-right'));
  const field = h('textarea', {
    class: 'login-field',
    rows: 3,
    placeholder: t('login.placeholder'),
    'aria-label': t('login.placeholder'),
    spellcheck: 'false',
    autocomplete: 'off',
  });
  let info: TokenInfo | null = null;
  let timer = 0;
  let seq = 0;

  // Сообщение в строке состояния: `bad` — красным.
  const say = (text: string, kind: 'ok' | 'bad' | '' = '') => {
    status.className = kind ? `login-status ${kind}` : 'login-status';
    status.textContent = text;
  };
  // Ошибка, оставшаяся с прошлого экрана (например, «Забыть токен» не дошёл до ядра).
  let shownError = getState().error;
  if (shownError) say(loginErrorText(shownError), 'bad');
  // Новая ошибка, пока экран открыт (масштаб не сохранился или не применился): сразу в строку состояния,
  // экран не пересоздаётся, вставленный токен остаётся.
  const unsubscribe = subscribe((state) => {
    if (state.error === shownError) return;
    shownError = state.error;
    if (shownError) say(loginErrorText(shownError), 'bad');
  });

  const switchLanguage = async () => {
    const error = await switchLang(getLang() === 'ru' ? 'en' : 'ru');
    if (error) say(errorText(error), 'bad');
  };
  const openTokenPage = async () => {
    try {
      await api.openTokenPage();
    } catch {
      say(t('login.openFailed', { url: TOKEN_PAGE }), 'bad');
    }
  };

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
      status.textContent = loginErrorText(asUiError(e));
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
    signIn(info);
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
          { class: 'lang', type: 'button', 'aria-label': t('top.lang'), onclick: () => void switchLanguage() },
          lang.toUpperCase(),
        ),
      ),
      h('h1', { class: 'login-title' }, t('login.title')),
      h('p', { class: 'muted' }, t('login.lead')),
      h('ol', { class: 'steps' }, h('li', {}, t('login.step1')), h('li', {}, t('login.step2')), h('li', {}, t('login.step3'))),
      h('button', { class: 'btn sec', type: 'button', onclick: () => void openTokenPage() }, icon('external-link'), t('login.open')),
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
  return {
    el,
    destroy: () => {
      window.clearTimeout(timer);
      unsubscribe();
    },
  };
}
