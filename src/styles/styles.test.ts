// Проверки стилей, которые легко сломать незаметно: контраст мелкого текста, кольцо фокуса,
// закреплённые кнопки панели и число колонок сетки в окне наименьшего размера (1024×640).

import { describe, expect, it } from 'vitest';
import { columnsFor, GAP, MIN_CARD_WIDTH } from '../ui/virtual';
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

  it('keeps the token field to about three lines', () => {
    expect(parseFloat(prop(rule(loginCss, '.login-field'), 'min-height'))).toBeLessThanOrEqual(80);
  });
});
