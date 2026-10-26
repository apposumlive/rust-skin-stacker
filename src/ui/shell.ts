import { h } from '../dom';
import { t } from '../i18n';
import type { Screen } from './login';

export function mountMain(): Screen {
  return { el: h('main', { class: 'login' }, h('h1', {}, t('grid.title'))), destroy: () => {} };
}
