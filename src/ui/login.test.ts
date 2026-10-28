import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setUiScale } from '../actions';
import { useApi, type Api } from '../api';
import { errorText, setLang, t } from '../i18n';
import { defaultFilter } from '../model';
import { getState, initState, setState } from '../store';
import { byClass, byTag, FakeEl, fakeDocument } from './fake-dom';
import { loginErrorText, renderLogin } from './login';

afterEach(() => setLang('en'));

describe('login error text', () => {
  it('explains busy after a reload during a run instead of «an operation is already running»', () => {
    for (const lang of ['en', 'ru'] as const) {
      setLang(lang);
      const text = loginErrorText({ code: 'busy', status: null });
      expect(text).toBe(t('login.busy'));
      expect(text).not.toBe(errorText({ code: 'busy', status: null }));
    }
  });

  it('uses the usual text for every other error', () => {
    expect(loginErrorText({ code: 'tokenNotFound', status: null })).toBe(errorText({ code: 'tokenNotFound', status: null }));
    expect(loginErrorText({ code: 'http', status: 502 })).toBe(errorText({ code: 'http', status: 502 }));
  });
});

describe('login screen', () => {
  beforeEach(() => {
    setLang('en');
    vi.stubGlobal('document', fakeDocument);
    vi.stubGlobal('HTMLElement', FakeEl);
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    initState({
      screen: 'login',
      lang: 'en',
      settings: { language: null, delayMs: 1500, uiScale: 0 },
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
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const parts = (el: unknown) => ({ status: byClass(el, 'login-status')[0], field: byTag(el, 'textarea')[0] });

  it('shows an error that comes while it is open and keeps the pasted token', async () => {
    useApi({ saveSettings: () => Promise.reject({ code: 'settingsNotSaved' }) } as unknown as Api);
    const screen = renderLogin();
    const { status, field } = parts(screen.el);
    field.value = 'pasted';
    // Ctrl+= на экране входа: масштаб не сохранился.
    await setUiScale(110);
    expect(status.textContent).toBe(t('error.settingsNotSaved'));
    expect(status.classes.has('bad')).toBe(true);
    expect(field.value).toBe('pasted');
    expect(parts(screen.el).field).toBe(field);
    screen.destroy();
  });

  it('does not bring an old error back on other changes', () => {
    setState({ error: { code: 'settingsNotSaved', status: null } });
    const screen = renderLogin();
    const { status } = parts(screen.el);
    expect(status.textContent).toBe(t('error.settingsNotSaved'));
    status.textContent = 'typing';
    setState({ loading: true });
    expect(status.textContent).toBe('typing');
    screen.destroy();
  });

  it('stops listening when it is closed', () => {
    const screen = renderLogin();
    const { status } = parts(screen.el);
    screen.destroy();
    setState({ error: { code: 'zoomFailed', status: null } });
    expect(getState().error).not.toBeNull();
    expect(status.textContent).toBe('');
  });
});
