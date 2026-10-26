import { afterEach, describe, expect, it } from 'vitest';
import { errorText, setLang, t } from '../i18n';
import { loginErrorText } from './login';

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
