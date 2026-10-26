import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import '@tabler/icons-webfont/dist/tabler-icons.min.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/login.css';

import { loadInventory, selectSkin, setFilter, showPlan } from './actions';
import { api, inTauri, useApi } from './api';
import { detectLang, setLang } from './i18n';
import { visibleSkins } from './model';
import { getState, initState, initialFilter, setState, subscribe, type State } from './store';
import { renderLogin, type Screen } from './ui/login';
import { mountMain } from './ui/shell';

async function boot(): Promise<void> {
  // В обычном браузере (npm run dev) Tauri нет — работает демо-режим. В сборку он не попадает.
  if (import.meta.env.DEV && !inTauri()) {
    const { createMockApi } = await import('./dev/mock');
    useApi(createMockApi());
  }
  const settings = await api.getSettings();
  const lang = settings.language ?? detectLang(navigator.language);
  setLang(lang);
  initState({
    screen: 'login',
    lang,
    settings,
    token: null,
    inventory: null,
    loading: false,
    error: null,
    tokenExpired: false,
    filter: initialFilter,
    selected: [],
    anchor: null,
    panel: { kind: 'selection' },
    menuOpen: false,
    settingsOpen: false,
  });

  const root = document.getElementById('app')!;
  let screen: Screen | null = null;
  let shown = '';
  // Экран перестраивается при смене экрана или языка.
  const show = (s: State) => {
    const id = `${s.screen}:${s.lang}`;
    if (id === shown) return;
    shown = id;
    document.documentElement.lang = s.lang;
    screen?.destroy();
    screen = s.screen === 'login' ? renderLogin() : mountMain();
    root.replaceChildren(screen.el);
  };
  subscribe(show);
  show(getState());

  if (import.meta.env.DEV && !inTauri()) await openDemoState();
}

/** `?demo=main|item|plan` — состояния с макетов docs/design/ для снимков в браузере. */
async function openDemoState(): Promise<void> {
  const demo = new URLSearchParams(location.search).get('demo');
  if (!demo) return;
  const token = await api.setToken('demo');
  setState({ screen: 'main', token });
  await loadInventory();
  const s = getState();
  if (!s.inventory || demo === 'main') return;
  setFilter({ show: 'stacks' });
  if (demo === 'item') {
    const order = visibleSkins(s.inventory, getState().filter).map((skin) => skin.key);
    const key = order[4];
    if (key) selectSkin(key, 'single', order);
  }
  if (demo === 'plan') await showPlan({ kind: 'splitAll' });
}

void boot();
