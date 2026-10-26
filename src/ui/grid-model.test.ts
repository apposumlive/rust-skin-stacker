import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { defaultFilter, type Filter } from '../model';
import type { Inventory, Plan, Skin } from '../types';
import { currentKey, emptyStateOf, gridKey, gridMeta } from './grid-model';

const skin = (key: string): Skin => ({ key, name: key, icon: null, category: null, total: 1, records: [] });
const inventory = (...keys: string[]): Inventory => ({ skins: keys.map(skin), unreadable: [] });
const filter = (over: Partial<Filter> = {}): Filter => ({ ...defaultFilter(), ...over });

afterEach(() => setLang('en'));

describe('grid header', () => {
  it('names what the grid shows now, not the stacks of the whole inventory', () => {
    setLang('ru');
    expect(gridMeta('all', 40)).toBe('40 предметов');
    expect(gridMeta('stacks', 16)).toBe('16 предметов в стопках');
    expect(gridMeta('dupes', 5)).toBe('5 дублей');
    expect(gridMeta('all', 1)).toBe('1 предмет');
    expect(gridMeta('stacks', 3)).toBe('3 предмета в стопках');
    expect(gridMeta('dupes', 22)).toBe('22 дубля');
    expect(gridMeta('dupes', 21)).toBe('21 дубль');
  });

  it('has English forms too', () => {
    setLang('en');
    expect(gridMeta('all', 1)).toBe('1 item');
    expect(gridMeta('all', 40)).toBe('40 items');
    expect(gridMeta('stacks', 16)).toBe('16 items in stacks');
    expect(gridMeta('dupes', 5)).toBe('5 duplicates');
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
    expect(currentKey({ kind: 'running', plan, done: 1, total: 4, errors: 0, key: 'A', waitUntil: null, stopping: false })).toBe('A');
    expect(currentKey({ kind: 'running', plan, done: 4, total: 4, errors: 0, key: '', waitUntil: null, stopping: false })).toBe('');
    expect(currentKey({ kind: 'plan', plan, changed: false })).toBe('');
    expect(currentKey({ kind: 'selection' })).toBe('');
  });
});
