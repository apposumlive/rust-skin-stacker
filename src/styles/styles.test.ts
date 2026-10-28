// Проверки стилей, которые легко сломать незаметно: контраст мелкого текста, кольцо фокуса,
// закреплённые кнопки панели и число колонок сетки в окне наименьшего размера (1024×640).

import { describe, expect, it } from 'vitest';
import { columnsFor, GAP, MIN_CARD_WIDTH } from '../ui/virtual';
import baseCss from './base.css?raw';
import loginCss from './login.css?raw';
import mainCss from './main.css?raw';
import panelCss from './panel.css?raw';
import tokensCss from './tokens.css?raw';

/** Самая широкая классическая полоса прокрутки Windows; тонкая в WebView2 уже. */
const SCROLLBAR = 17;

const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Объявления правила с точно таким селектором (первое вхождение вне @media). */
function rule(css: string, selector: string): string {
  for (const match of noComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].trim().split(/\s*,\s*/);
    if (selectors.includes(selector)) return match[2];
  }
  throw new Error(`no rule ${selector}`);
}

/** Содержимое блока @media с этим условием. */
function media(css: string, condition: string): string {
  const start = noComments(css).indexOf(`@media ${condition} {`);
  if (start < 0) throw new Error(`no @media ${condition}`);
  const rest = noComments(css).slice(start);
  return rest.slice(rest.indexOf('{') + 1, rest.indexOf('\n}'));
}

function prop(body: string, name: string): string {
  const match = body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+)`));
  if (!match) throw new Error(`no ${name} in ${body}`);
  return match[1].trim();
}

const token = (name: string) => prop(rule(tokensCss, ':root'), `--${name}`);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('palette', () => {
  it('keeps the colours of the spec', () => {
    expect(token('text-3')).toBe('#6c7287');
    expect(token('acc-2')).toBe('#7171ff');
  });

  it('has accent text and secondary text readable on every surface (≥ 4.5)', () => {
    for (const surface of ['card', 'card-2', 'card-hover']) expect(contrast(token('acc-text'), token(surface))).toBeGreaterThanOrEqual(4.5);
    for (const surface of ['bg', 'panel', 'card', 'card-2']) expect(contrast(token('text-2'), token(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it('puts small readable text on --text-2, not on --text-3', () => {
    const small: Array<[string, string]> = [
      [mainCss, '.search'],
      [mainCss, '.search-input::placeholder'],
      [mainCss, '.fh'],
      [mainCss, '.opt .c'],
      [mainCss, '.stats'],
      [panelCss, '.foot'],
      [panelCss, '.ticks'],
      [panelCss, '.queue .r'],
      [panelCss, '.queue .more'],
      [loginCss, '.disclaimer'],
      [loginCss, '.login-field::placeholder'],
    ];
    for (const [css, selector] of small) expect(prop(rule(css, selector), 'color'), selector).toBe('var(--text-2)');
  });

  it('colours accent text with --acc-text', () => {
    expect(prop(rule(mainCss, '.card .becomes'), 'color')).toBe('var(--acc-text)');
    expect(prop(rule(mainCss, '.bulk.active'), 'color')).toBe('var(--acc-text)');
  });

  it('writes «processed» on a card neutrally, not in green', () => {
    expect(prop(rule(mainCss, '.card .processed'), 'color')).toBe('var(--text-2)');
  });
});

describe('layout', () => {
  it('draws the focus ring of a card inside it, where the scroller does not clip it', () => {
    expect(parseFloat(prop(rule(mainCss, '.card:focus-visible'), 'outline-offset'))).toBeLessThan(0);
  });

  it('scrolls the panel content and keeps the buttons docked', () => {
    expect(prop(rule(mainCss, '.side'), 'overflow')).toBe('hidden');
    const panel = rule(panelCss, '.panel');
    expect(prop(panel, 'height')).toBe('100%');
    expect(prop(panel, 'flex-direction')).toBe('column');
    const body = rule(panelCss, '.pbody');
    expect(prop(body, 'overflow-y')).toBe('auto');
    expect(prop(body, 'min-height')).toBe('0');
    expect(prop(rule(panelCss, '.dock'), 'flex')).toBe('none');
    expect(prop(rule(panelCss, '.queue'), 'overflow-y')).toBe('auto');
  });

  it('keeps the counts of the filter options in one column when a label wraps', () => {
    const opt = rule(mainCss, '.opt');
    // Флажок и число — по первой строке подписи, а не посередине двух строк.
    expect(prop(opt, 'align-items')).toBe('flex-start');
    expect(prop(rule(mainCss, '.opt .c'), 'margin-left')).toBe('auto');
    // У «Нельзя передать» шрифт как у соседних строк, число не уходит строкой ниже.
    const long = rule(mainCss, '.opt.long .lbl');
    expect(prop(long, 'flex')).toBe('1');
    expect(prop(long, 'min-width')).toBe('0');
    expect(mainCss).not.toMatch(/\.opt\.long\s*\{[^}]*(font-size|flex-wrap)/);
  });

  it('lets only the last card pill shrink, with an ellipsis instead of a letter cut in half', () => {
    // Плашки стопок («×5») не сжимаются; последняя («3 по одному» или «+N») сжимается и обрезается многоточием.
    const pill = rule(mainCss, '.pill');
    expect(prop(pill, 'flex')).toBe('none');
    expect(prop(pill, 'white-space')).toBe('nowrap');
    expect(prop(pill, 'font-size')).toBe('12px');
    const last = rule(mainCss, '.pill:last-child');
    expect(prop(last, 'flex-shrink')).toBe('1');
    expect(prop(last, 'min-width')).toBe('0');
    expect(prop(last, 'overflow')).toBe('hidden');
    expect(prop(last, 'text-overflow')).toBe('ellipsis');
  });

  it('makes the big picture smaller in a low window', () => {
    const low = media(panelCss, '(max-height: 700px)');
    expect(parseFloat(prop(rule(low, '.big'), 'height'))).toBeLessThan(parseFloat(prop(rule(panelCss, '.big'), 'height')));
  });

  it('fits 3 card columns at 1024 px and 4 at 1280 px', () => {
    const columns = (css: string) => prop(rule(css, '.wrap'), 'grid-template-columns').match(/^(\d+)px minmax\(0, 1fr\) (\d+)px$/)!;
    const padding = (css: string) => parseFloat(prop(rule(css, '.content'), 'padding').split(/\s+/)[1]);
    const grid = (width: number, css: string) => {
      const [, left, right] = columns(css);
      return width - Number(left) - Number(right) - 2 * padding(css) - SCROLLBAR;
    };
    const narrow = media(mainCss, '(max-width: 1099px)');
    expect(columnsFor(grid(1024, narrow), MIN_CARD_WIDTH, GAP)).toBe(3);
    expect(columnsFor(grid(1280, mainCss), MIN_CARD_WIDTH, GAP)).toBe(4);
  });

  it('puts the split-off counter under its heading in the narrow panel', () => {
    // В широкой панели счётчик справа от заголовка, в одну строку.
    expect(rule(panelCss, '.sec-h')).not.toMatch(/flex-direction/);
    const narrow = rule(media(panelCss, '(max-width: 1099px)'), '.sec-h');
    expect(prop(narrow, 'flex-direction')).toBe('column');
    expect(prop(narrow, 'align-items')).toBe('flex-start');
    // Узкая колонка включается при той же ширине окна.
    expect(prop(rule(media(mainCss, '(max-width: 1099px)'), '.wrap'), 'grid-template-columns')).toMatch(/ 304px$/);
  });

  it('keeps the token field to about three lines', () => {
    expect(parseFloat(prop(rule(loginCss, '.login-field'), 'min-height'))).toBeLessThanOrEqual(80);
  });

  it('fits the sign-in screen into 1152×720 (a 1440×900 window at 125 %) with at least 12 px to spare', () => {
    // Высоты блоков карточки, замеренные в Chrome (RU и EN одинаковы): шапка, заголовок, вводный текст, шаги,
    // кнопка страницы токена, поле, пустая строка состояния, «Продолжить», «Почему это безопасно», дисклеймер.
    const blocks = [30, 29, 40, 88, 44, 85, 20, 44, 144, 19];
    const vertical = (padding: string) => {
      const [top, , bottom = top] = padding.split(/\s+/).map(parseFloat);
      return top + bottom;
    };
    const card = rule(loginCss, '.login-card');
    // Отрицательные поля строки состояния прижимают её к полю; без них — 0.
    const status = rule(loginCss, '.login-status');
    const margin = /(?:^|[;\s])margin\s*:/.test(status) ? prop(status, 'margin') : '0';
    const [statusTop, , statusBottom = statusTop] = margin.split(/\s+/).map(parseFloat);
    const height =
      vertical(prop(rule(loginCss, '.login'), 'padding')) +
      vertical(prop(card, 'padding')) +
      2 + // рамка карточки
      parseFloat(prop(card, 'gap')) * (blocks.length - 1) +
      statusTop +
      statusBottom +
      blocks.reduce((a, b) => a + b, 0);
    // Окно 1280×800 выше: там запас больше.
    expect(height).toBeLessThanOrEqual(720 - 12);
  });
});

describe('item pictures', () => {
  const pictures = ['.imgbox img', '.big img', '.thumb img', '.qimg img'];

  it('hides a picture until it has loaded, then fades it in over 200 ms', () => {
    for (const selector of pictures) {
      const before = rule(baseCss, selector);
      expect(prop(before, 'opacity'), selector).toBe('0');
      expect(prop(before, 'transition'), selector).toBe('opacity 0.2s var(--ease)');
      expect(prop(rule(baseCss, `${selector.replace(/ img$/, '')} img.loaded`), 'opacity'), selector).toBe('1');
    }
  });

  it('shows the picture at once, without a transition, when motion is reduced', () => {
    const reduced = media(baseCss, '(prefers-reduced-motion: reduce)');
    expect(prop(rule(reduced, '*'), 'transition')).toMatch(/^none/);
    for (const selector of pictures) expect(prop(rule(reduced, selector), 'opacity'), selector).toBe('1');
  });

  it('keeps the tile under the picture', () => {
    const tiles: Array<[string, string]> = [
      [mainCss, '.imgbox'],
      [panelCss, '.big'],
      [panelCss, '.thumb'],
      [panelCss, '.qimg'],
    ];
    for (const [css, selector] of tiles) expect(prop(rule(css, selector), 'background'), selector).toBe('var(--img)');
  });
});
