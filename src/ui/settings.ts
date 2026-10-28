// Боковая панель настроек: язык, масштаб интерфейса («Авто» или 100–150 %) и пауза между запросами.

import { saveSettings } from '../actions';
import { asUiError } from '../api';
import { h, icon } from '../dom';
import { fmtPercent, fmtSeconds } from '../format';
import { errorText, t } from '../i18n';
import { setState, type State } from '../store';
import type { Settings } from '../types';
import { AUTO, UI_SCALES, type UiScale } from '../zoom';
import { canRestoreFocus, MAX_DELAY, MIN_DELAY, nextFocusIndex, snapDelay, STEP } from './settings-model';
import type { Part } from './shell';
import { focusMenuButton } from './topbar';
import { currentAutoScale } from './zoom';

const FOCUSABLE = 'button, select, input, textarea, [href], [tabindex]:not([tabindex="-1"])';

/** Элементы панели, до которых доходит Tab: не отключённые и не скрытые. */
function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.matches(':disabled') && !el.hidden && el.getClientRects().length > 0,
  );
}

/** `autoNow` — сколько «Авто» даёт сейчас: это пишется в его пункте. */
export function createSettings(host: HTMLElement, autoNow: () => UiScale = currentAutoScale): Part {
  let open = false;
  let restoreFocus: HTMLElement | null = null;
  let lastInside: HTMLElement | null = null;
  // Масштаб в открытой панели следует за клавишами Ctrl+= / Ctrl+− / Ctrl+0 (они сохраняют его сразу).
  let followScale: ((scale: number) => void) | null = null;
  const close = () => setState({ settingsOpen: false });
  const drawerEl = () => host.querySelector<HTMLElement>('.drawer');

  // Пока панель открыта, всё остальное окно недоступно ни мышью, ни Tab, ни чтецу экрана.
  const setBackgroundInert = (inert: boolean) => {
    for (const sibling of Array.from(host.parentElement?.children ?? [])) {
      if (sibling !== host && sibling instanceof HTMLElement) sibling.inert = inert;
    }
  };

  // Tab ходит по кругу внутри панели; если фокус оказался снаружи, возвращаем его внутрь.
  const trapTab = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const drawer = drawerEl();
    if (!drawer) return;
    e.preventDefault();
    const items = focusables(drawer);
    const active = document.activeElement;
    const next = nextFocusIndex(active instanceof HTMLElement ? items.indexOf(active) : -1, items.length, e.shiftKey);
    items[next]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'Tab') trapTab(e);
  };
  // Фокус, ушедший за панель (программно или щелчком), возвращается на последний элемент внутри.
  const onFocusIn = (e: FocusEvent) => {
    const drawer = open ? drawerEl() : null;
    if (!drawer) return;
    const target = e.target;
    if (target instanceof HTMLElement && drawer.contains(target)) {
      lastInside = target;
      return;
    }
    const items = focusables(drawer);
    (lastInside && items.includes(lastInside) ? lastInside : items[0])?.focus();
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('focusin', onFocusIn);

  const render = (state: State) => {
    let delay = snapDelay(state.settings.delayMs);
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

    let uiScale = state.settings.uiScale;
    let savedScale = uiScale;
    const scale = h(
      'select',
      { class: 'select', 'aria-label': t('settings.scale') },
      h('option', { value: AUTO }, t('settings.scaleAuto', { value: fmtPercent(autoNow()) })),
      ...UI_SCALES.map((value) => h('option', { value }, fmtPercent(value))),
    );
    scale.value = String(uiScale);
    scale.addEventListener('change', () => {
      uiScale = Number(scale.value);
    });
    // Клавиши сохранили другой масштаб, пока панель открыта: поле показывает его, и «Сохранить» его не откатит.
    followScale = (next) => {
      if (next === savedScale) return;
      savedScale = next;
      uiScale = next;
      scale.value = String(next);
    };

    const error = h('p', { class: 'field-error', role: 'alert' });
    const saveButton = h('button', { class: 'btn pri', type: 'button', onclick: () => void save() }, t('settings.save'));
    let saving = false;
    const save = async () => {
      if (saving) return;
      saving = true;
      saveButton.disabled = true;
      error.textContent = '';
      const next: Settings = { language, delayMs: delay, uiScale };
      try {
        await saveSettings(next);
      } catch (e) {
        error.textContent = errorText(asUiError(e));
      } finally {
        saving = false;
        saveButton.disabled = false;
        // Отключённая кнопка теряет фокус: при ошибке панель осталась, вернём его на «Сохранить».
        if (saveButton.isConnected && document.activeElement === document.body) saveButton.focus();
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
        h('span', { class: 'fh' }, t('settings.scale')),
        scale,
        h('p', { class: 'muted small' }, t('settings.scaleHint')),
      ),
      h(
        'div',
        { class: 'field' },
        h('div', { class: 'field-row' }, h('span', { class: 'fh' }, t('settings.delay')), value),
        range,
        h('p', { class: 'muted small' }, t('settings.delayHint')),
      ),
      error,
      h('div', { class: 'grow' }),
      h('p', { class: 'muted small' }, t('settings.about'), ' ', h('span', { class: 'num' }, t('settings.version', { version: __APP_VERSION__ }))),
      h('div', { class: 'acts' }, saveButton, h('button', { class: 'btn sec', type: 'button', onclick: close }, t('settings.close'))),
    );
    host.replaceChildren(h('div', { class: 'backdrop', onclick: close }), drawer);
    select.focus();
  };

  return {
    update(state) {
      if (state.settingsOpen === open) {
        if (open) followScale?.(state.settings.uiScale);
        return;
      }
      open = state.settingsOpen;
      if (open) {
        restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        lastInside = null;
        render(state);
        setBackgroundInert(true);
      } else {
        // Фон снова доступен до возврата фокуса: иначе он не дойдёт до кнопки меню.
        setBackgroundInert(false);
        host.replaceChildren();
        followScale = null;
        if (canRestoreFocus(restoreFocus, document.body)) restoreFocus?.focus();
        else focusMenuButton();
        restoreFocus = null;
        lastInside = null;
      }
    },
    destroy() {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      setBackgroundInert(false);
    },
  };
}
