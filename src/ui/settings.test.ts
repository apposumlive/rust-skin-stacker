import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useApi, type Api } from '../api';
import { fmtPercent } from '../format';
import { setLang, t } from '../i18n';
import { defaultFilter } from '../model';
import { initState, type State } from '../store';
import type { Settings } from '../types';
import { AUTO, type UiScale } from '../zoom';
import { byClass, byTag, FakeEl, fakeDocument, findAll, fire } from './fake-dom';
import { createSettings } from './settings';

const settings: Settings = { language: null, delayMs: 1500, uiScale: 100 };

function stateOf(over: Partial<State> = {}): State {
  return {
    screen: 'main',
    lang: 'en',
    settings,
    token: null,
    inventory: null,
    loading: false,
    loadWaitUntil: null,
    loadStopping: false,
    error: null,
    tokenExpired: false,
    filter: defaultFilter(),
    selected: [],
    anchor: null,
    panel: { kind: 'selection' },
    menuOpen: false,
    settingsOpen: false,
    ...over,
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const byLabel = (root: unknown, label: string): FakeEl => {
  const [el] = findAll(root, (node) => node.getAttribute('aria-label') === label);
  if (!el) throw new Error(`no element labelled ${label}`);
  return el;
};

const button = (root: unknown, text: string): FakeEl => {
  const [el] = byTag(root, 'button').filter((b) => b.textContent === text);
  if (!el) throw new Error(`no button ${text}`);
  return el;
};

let save: Mock<Api['saveSettings']>;

/** Открытая панель настроек на подставном DOM; ядро сохраняет то, что прислали. «Авто» сейчас даёт `auto`. */
function openPanel(over: Partial<State> = {}, auto: UiScale = 125) {
  const host = new FakeEl('div');
  const part = createSettings(host as unknown as HTMLElement, () => auto);
  const state = stateOf(over);
  initState(state);
  part.update({ ...state, settingsOpen: true });
  return { host, part };
}

beforeEach(() => {
  setLang('en');
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('HTMLElement', FakeEl);
  fakeDocument.activeElement = null;
  save = vi.fn<Api['saveSettings']>(async (next) => next);
  useApi({ saveSettings: save } as unknown as Api);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('interface scale in the settings panel', () => {
  it('stands after the language and before the pause, with the hint under it', () => {
    const { host } = openPanel();
    const fields = byClass(host, 'field');
    expect(fields.map((f) => byClass(f, 'fh')[0]?.textContent)).toEqual([t('settings.language'), t('settings.scale'), t('settings.delay')]);
    const scale = fields[1];
    expect(byTag(scale, 'select')).toHaveLength(1);
    expect(byTag(scale, 'p').map((p) => p.textContent)).toEqual([t('settings.scaleHint')]);
  });

  it('offers Auto with what it gives now, then 100, 110, 125 and 150 %, and shows the saved one', () => {
    const { host } = openPanel({ settings: { ...settings, uiScale: 125 } }, 110);
    const select = byLabel(host, t('settings.scale'));
    const options = byTag(select, 'option');
    expect(options.map((o) => o.value)).toEqual(['0', '100', '110', '125', '150']);
    expect(options.map((o) => o.textContent)).toEqual(['Auto (now 110%)', '100%', '110%', '125%', '150%']);
    expect(select.value).toBe('125');
  });

  it('shows Auto when it is saved', () => {
    const { host } = openPanel({ settings: { ...settings, uiScale: AUTO } });
    expect(byLabel(host, t('settings.scale')).value).toBe('0');
  });

  it('sends Auto on Save', async () => {
    const { host } = openPanel();
    const select = byLabel(host, t('settings.scale'));
    select.value = '0';
    fire(select, 'change');
    fire(button(host, t('settings.save')), 'click');
    await tick();
    expect(save).toHaveBeenCalledWith({ language: null, delayMs: 1500, uiScale: AUTO });
  });

  it('writes the percents the Russian way', () => {
    setLang('ru');
    const { host } = openPanel({ lang: 'ru' });
    const options = byTag(byLabel(host, t('settings.scale')), 'option');
    expect(options.map((o) => o.textContent)).toEqual([t('settings.scaleAuto', { value: fmtPercent(125) }), ...[100, 110, 125, 150].map(fmtPercent)]);
    expect(options[0].textContent).toBe('Авто (сейчас 125\u00a0%)');
    expect(options[1].textContent).toBe('100\u00a0%');
  });

  it('sends the chosen scale with the other settings on Save', async () => {
    const { host } = openPanel();
    const select = byLabel(host, t('settings.scale'));
    select.value = '150';
    fire(select, 'change');
    fire(button(host, t('settings.save')), 'click');
    await tick();
    expect(save).toHaveBeenCalledWith({ language: null, delayMs: 1500, uiScale: 150 });
  });

  it('sends the saved scale when it was not touched', async () => {
    const { host } = openPanel({ settings: { language: 'ru', delayMs: 3000, uiScale: 110 } });
    fire(button(host, t('settings.save')), 'click');
    await tick();
    expect(save).toHaveBeenCalledWith({ language: 'ru', delayMs: 3000, uiScale: 110 });
  });

  it('follows the scale changed by the keys while the panel is open', async () => {
    const { host, part } = openPanel();
    // Ctrl+= сохранил 110, панель открыта: «Сохранить» не должна вернуть прежние 100.
    part.update(stateOf({ settingsOpen: true, settings: { ...settings, uiScale: 110 } }));
    const select = byLabel(host, t('settings.scale'));
    expect(select.value).toBe('110');
    fire(button(host, t('settings.save')), 'click');
    await tick();
    expect(save).toHaveBeenCalledWith({ language: null, delayMs: 1500, uiScale: 110 });
  });

  it('keeps an unsaved choice when something else in the window changes', async () => {
    const { host, part } = openPanel();
    const select = byLabel(host, t('settings.scale'));
    select.value = '125';
    fire(select, 'change');
    part.update(stateOf({ settingsOpen: true, loading: true }));
    expect(select.value).toBe('125');
    fire(button(host, t('settings.save')), 'click');
    await tick();
    expect(save).toHaveBeenCalledWith({ language: null, delayMs: 1500, uiScale: 125 });
  });
});
