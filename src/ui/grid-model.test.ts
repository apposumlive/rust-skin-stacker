import { afterEach, describe, expect, it } from 'vitest';
import { setLang, t } from '../i18n';
import { defaultFilter, type Filter } from '../model';
import type { Inventory, Plan, Skin } from '../types';
import { cardNote, currentKey, emptyStateOf, gridKey, gridMeta, processedKeys } from './grid-model';

const skin = (key: string): Skin => ({ key, name: key, icon: null, category: null, total: 1, records: [] });
const inventory = (...keys: string[]): Inventory => ({ skins: keys.map(skin), unreadable: [] });
const filter = (over: Partial<Filter> = {}): Filter => ({ ...defaultFilter(), ...over });

afterEach(() => setLang('en'));

describe('grid header', () => {
  it('names what the grid shows now, not the stacks of the whole inventory', () => {
    setLang('ru');
    expect(gridMeta('all', 40)).toBe('40\u00a0предметов');
    expect(gridMeta('stacks', 16)).toBe('16\u00a0предметов в стопках');
    expect(gridMeta('dupes', 5)).toBe('5\u00a0предметов можно собрать');
    expect(gridMeta('all', 1)).toBe('1\u00a0предмет');
    expect(gridMeta('stacks', 3)).toBe('3\u00a0предмета в стопках');
    expect(gridMeta('dupes', 22)).toBe('22\u00a0предмета можно собрать');
    expect(gridMeta('dupes', 21)).toBe('21\u00a0предмет можно собрать');
    expect(gridMeta('dupes', 11)).toBe('11\u00a0предметов можно собрать');
  });

  it('has English forms too', () => {
    setLang('en');
    expect(gridMeta('all', 1)).toBe('1\u00a0item');
    expect(gridMeta('all', 40)).toBe('40\u00a0items');
    expect(gridMeta('stacks', 16)).toBe('16\u00a0items in stacks');
    expect(gridMeta('dupes', 1)).toBe('1\u00a0item can be combined');
    expect(gridMeta('dupes', 5)).toBe('5\u00a0items can be combined');
  });

  it('calls the filter of items with several entries «Можно собрать» and keeps «Записей в Steam»', () => {
    setLang('ru');
    expect(t('filters.dupes')).toBe('Можно собрать');
    expect(t('filters.dupesHint')).toBe('Предметы из нескольких записей: их можно собрать в стопки');
    expect(t('stats.records')).toBe('Записей в Steam');
    setLang('en');
    expect(t('filters.dupes')).toBe('Can combine');
    expect(t('filters.dupesHint')).toBe('Items made of several entries that can be combined into stacks');
    expect(t('stats.records')).toBe('Entries in Steam');
  });
});

describe('empty grid', () => {
  it('says that no stacks are left and offers all items after everything was split', () => {
    expect(emptyStateOf(inventory('A'), filter({ show: 'stacks' }))).toEqual({ text: 'grid.noStacks', action: 'showAll' });
  });

  it('offers to reset the filters when a search or a type hides everything', () => {
    expect(emptyStateOf(inventory('A'), filter({ show: 'stacks', search: 'x' }))).toEqual({ text: 'grid.nothingFound', action: 'reset' });
    expect(emptyStateOf(inventory('A'), filter({ show: 'stacks', categories: ['Tool'] }))).toEqual({
      text: 'grid.nothingFound',
      action: 'reset',
    });
    expect(emptyStateOf(inventory('A'), filter({ show: 'dupes' }))).toEqual({ text: 'grid.nothingFound', action: 'reset' });
    expect(emptyStateOf(inventory('A'), filter({ search: 'x' }))).toEqual({ text: 'grid.nothingFound', action: 'reset' });
  });

  it('ignores a search of only spaces', () => {
    expect(emptyStateOf(inventory('A'), filter({ show: 'stacks', search: '  ' }))).toEqual({ text: 'grid.noStacks', action: 'showAll' });
  });

  it('has no button when the inventory itself is empty', () => {
    expect(emptyStateOf(inventory(), filter({ show: 'stacks', search: 'x' }))).toEqual({ text: 'grid.empty', action: null });
  });
});

describe('card keys', () => {
  it('moves with arrows, pages, Home and End, also on auto-repeat', () => {
    expect(gridKey('ArrowRight', false, false, 4, 40)).toEqual({ kind: 'move', delta: 1 });
    expect(gridKey('ArrowLeft', false, true, 4, 40)).toEqual({ kind: 'move', delta: -1 });
    expect(gridKey('ArrowDown', false, true, 4, 40)).toEqual({ kind: 'move', delta: 4 });
    expect(gridKey('ArrowUp', false, false, 4, 40)).toEqual({ kind: 'move', delta: -4 });
    expect(gridKey('PageDown', false, false, 3, 40)).toEqual({ kind: 'move', delta: 9 });
    expect(gridKey('PageUp', false, false, 3, 40)).toEqual({ kind: 'move', delta: -9 });
    expect(gridKey('Home', false, false, 3, 40)).toEqual({ kind: 'move', delta: -40 });
    expect(gridKey('End', false, false, 3, 40)).toEqual({ kind: 'move', delta: 40 });
  });

  it('selects with Space and Shift+Space, opens with Enter', () => {
    expect(gridKey(' ', false, false, 4, 40)).toEqual({ kind: 'pick', mode: 'toggle' });
    expect(gridKey(' ', true, false, 4, 40)).toEqual({ kind: 'pick', mode: 'range' });
    expect(gridKey('Enter', false, false, 4, 40)).toEqual({ kind: 'pick', mode: 'single' });
  });

  it('swallows auto-repeat of Space and Enter, so holding Space does not flip the selection', () => {
    expect(gridKey(' ', false, true, 4, 40)).toEqual({ kind: 'swallow' });
    expect(gridKey(' ', true, true, 4, 40)).toEqual({ kind: 'swallow' });
    expect(gridKey('Enter', false, true, 4, 40)).toEqual({ kind: 'swallow' });
  });

  it('leaves other keys alone', () => {
    expect(gridKey('Tab', false, false, 4, 40)).toBeNull();
    expect(gridKey('a', false, true, 4, 40)).toBeNull();
    expect(gridKey('toString', false, false, 4, 40)).toBeNull();
  });
});

describe('card being processed', () => {
  const plan: Plan = { operation: { kind: 'splitAll' }, requests: 4, stacks: 1, queue: [], more: 0, after: [] };

  it('is the key of the current request while the run goes, and none otherwise', () => {
    expect(currentKey({ kind: 'running', plan, done: 1, total: 4, errors: 0, key: 'A', processed: [], waitUntil: null, stopping: false })).toBe('A');
    expect(currentKey({ kind: 'running', plan, done: 4, total: 4, errors: 0, key: '', processed: ['A'], waitUntil: null, stopping: false })).toBe('');
    expect(currentKey({ kind: 'plan', plan, changed: false })).toBe('');
    expect(currentKey({ kind: 'selection' })).toBe('');
  });
});

describe('card note during a run', () => {
  const plan: Plan = { operation: { kind: 'splitAll' }, requests: 6, stacks: 3, queue: [], more: 0, after: [] };
  const done = new Set(['A']);

  it('says «becomes …» on a skin that is not touched yet', () => {
    expect(cardNote('C', true, 'B', done)).toBe('becomes');
    expect(cardNote('C', true, '', new Set())).toBe('becomes');
  });

  it('marks the skin being processed now', () => {
    expect(cardNote('B', true, 'B', done)).toBe('now');
    // Ключ вернулся: подсветка важнее отметки «обработано».
    expect(cardNote('A', true, 'A', done)).toBe('now');
  });

  it('says «processed» on a skin whose steps have passed, not «becomes …»', () => {
    expect(cardNote('A', true, 'B', done)).toBe('processed');
    expect(cardNote('A', true, '', done)).toBe('processed');
  });

  it('shows the pieces on a skin that is not in the plan', () => {
    expect(cardNote('Z', false, 'B', done)).toBe('total');
    expect(cardNote('Z', false, '', new Set(['Z']))).toBe('total');
  });

  it('takes the processed keys only from a running panel, with the same empty list otherwise', () => {
    const keys = ['A', 'B'];
    expect(processedKeys({ kind: 'running', plan, done: 4, total: 6, errors: 0, key: 'C', processed: keys, waitUntil: null, stopping: false })).toBe(keys);
    const none = processedKeys({ kind: 'plan', plan, changed: false });
    expect(none).toEqual([]);
    expect(processedKeys({ kind: 'selection' })).toBe(none);
  });

  it('has the processed label in both languages', () => {
    setLang('ru');
    expect(t('card.processed')).toBe('обработано');
    setLang('en');
    expect(t('card.processed')).toBe('processed');
  });
});
