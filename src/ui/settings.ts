// Боковая панель настроек: язык и пауза между запросами.

import { saveSettings } from '../actions';
import { asUiError } from '../api';
import { h, icon } from '../dom';
import { fmtSeconds } from '../format';
import { errorText, t } from '../i18n';
import { setState, type State } from '../store';
import type { Settings } from '../types';
import type { Part } from './shell';

const MIN_DELAY = 500;
const MAX_DELAY = 10_000;
const STEP = 500;

export function createSettings(host: HTMLElement): Part {
  let open = false;
  let restoreFocus: HTMLElement | null = null;
  const close = () => setState({ settingsOpen: false });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) close();
  };
  document.addEventListener('keydown', onKey);

  const render = (state: State) => {
    let delay = state.settings.delayMs;
    let language = state.settings.language;
    const value = h('output', { class: 'v num' });
    const range = h('input', {
      class: 'range',
      type: 'range',
      min: MIN_DELAY,
      max: MAX_DELAY,
      step: STEP,
      value: delay,
      'aria-label': t('settings.delay'),
    });
    const paint = () => {
      value.textContent = t('settings.delayValue', { value: fmtSeconds(delay) });
      range.style.setProperty('--fill', `${((delay - MIN_DELAY) / (MAX_DELAY - MIN_DELAY)) * 100}%`);
    };
    range.addEventListener('input', () => {
      delay = Number(range.value);
      paint();
    });
    paint();

    const select = h(
      'select',
      { class: 'select', 'aria-label': t('settings.language') },
      h('option', { value: '' }, t('settings.system')),
      h('option', { value: 'en' }, 'English'),
      h('option', { value: 'ru' }, 'Русский'),
    );
    select.value = language ?? '';
    select.addEventListener('change', () => {
      language = select.value === 'en' || select.value === 'ru' ? select.value : null;
    });

    const error = h('p', { class: 'field-error', role: 'alert' });
    const save = async () => {
      const next: Settings = { language, delayMs: delay };
      try {
        await saveSettings(next);
      } catch (e) {
        error.textContent = errorText(asUiError(e));
      }
    };

    const drawer = h(
      'div',
      { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'settings-title' },
      h(
        'div',
        { class: 'drawer-head' },
        h('h2', { id: 'settings-title' }, t('settings.title')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('settings.close'), onclick: close }, icon('x')),
      ),
      h('label', { class: 'field' }, h('span', { class: 'fh' }, t('settings.language')), select),
      h(
        'div',
        { class: 'field' },
        h('div', { class: 'field-row' }, h('span', { class: 'fh' }, t('settings.delay')), value),
        range,
        h('p', { class: 'muted small' }, t('settings.delayHint')),
      ),
      error,
      h('div', { class: 'grow' }),
      h('p', { class: 'muted small' }, t('settings.about')),
      h(
        'div',
        { class: 'acts' },
        h('button', { class: 'btn pri', type: 'button', onclick: () => void save() }, t('settings.save')),
        h('button', { class: 'btn sec', type: 'button', onclick: close }, t('settings.close')),
      ),
    );
    host.replaceChildren(h('div', { class: 'backdrop', onclick: close }), drawer);
    select.focus();
  };

  return {
    update(state) {
      if (state.settingsOpen === open) return;
      open = state.settingsOpen;
      if (open) {
        restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        render(state);
      } else {
        host.replaceChildren();
        restoreFocus?.focus();
        restoreFocus = null;
      }
    },
    destroy() {
      document.removeEventListener('keydown', onKey);
    },
  };
}
