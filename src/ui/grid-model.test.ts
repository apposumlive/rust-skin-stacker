import { afterEach, describe, expect, it } from 'vitest';
import { setLang, t } from '../i18n';
import { defaultFilter, type Filter } from '../model';
import type { Panel } from '../store';
import type { Inventory, Plan, Skin } from '../types';
import { bannerActionOf, bannerBusy, cardNote, currentKey, emptyStateOf, gridKey, gridMeta, iconsAfter, processedKeys } from './grid-model';

const skin = (key: string): Skin => ({ key, name: key, icon: null, category: null, total: 1, records: [] });
const inventory = (...keys: string[]): Inventory => ({ skins: keys.map(skin), unreadable: [] });
/** Дроп: одна запись, одна штука, не передаётся и без даты — в сетке по умолчанию скрыт. */
const drop = (key: string): Skin => ({
  ...skin(key),
  records: [{ assetid: `${key}-1`, classid: 'c1', instanceid: '0', amount: 1, tradable: false, marketable: false, availableAfter: null }],
});
const dropsOnly = (...keys: string[]): Inventory => ({ skins: keys.map(drop), unreadable: [] });
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

  it('calls the filter of items whose entries combine «Можно собрать» and keeps «Записей в Steam»', () => {
    setLang('ru');
    expect(t('filters.dupes')).toBe('Можно собрать');
    expect(t('filters.dupesHint')).toBe('Предметы, чьи записи можно собрать в стопки');
    expect(t('stats.records')).toBe('Записей в Steam');
    setLang('en');
    expect(t('filters.dupes')).toBe('Can combine');
    expect(t('filters.dupesHint')).toBe('Items whose entries can be combined into stacks');
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

  it('says that only untradable items are here and offers to show them', () => {
    const only = { text: 'grid.onlyUntradable', action: 'showUntradable' };
    expect(emptyStateOf(dropsOnly('A', 'B'), filter())).toEqual(only);
    // Поиск из одних пробелов поиском не считается.
    expect(emptyStateOf(dropsOnly('A'), filter({ search: '  ' }))).toEqual(only);
  });

  it('keeps «nothing found» when a search, a type or «Show» hides the items too', () => {
    const nothing = { text: 'grid.nothingFound', action: 'reset' };
    expect(emptyStateOf(dropsOnly('A'), filter({ search: 'x' }))).toEqual(nothing);
    expect(emptyStateOf(dropsOnly('A'), filter({ categories: ['Tool'] }))).toEqual(nothing);
    expect(emptyStateOf(dropsOnly('A'), filter({ show: 'dupes' }))).toEqual(nothing);
    // С флажком «Нельзя передать» скрывать нечего: новый случай не нужен.
    expect(emptyStateOf(dropsOnly('A'), filter({ untradable: true }))).toEqual(nothing);
    // Не всё скрыто как дроп, и поиск не находит и дроп — это уже общий случай.
    expect(emptyStateOf({ skins: [drop('A'), skin('B')], unreadable: [] }, filter({ search: 'x' }))).toEqual(nothing);
  });

  it('says that the search found only hidden untradable items and offers to show them', () => {
    const hidden = { text: 'grid.onlyHiddenMatch', action: 'showUntradable' };
    const tool = { ...drop('Drop C'), category: { id: 'Tool', label: 'Tool' } };
    const mixed: Inventory = { skins: [drop('Drop A'), skin('Plain B'), tool], unreadable: [] };
    expect(emptyStateOf(mixed, filter({ search: 'drop' }))).toEqual(hidden);
    expect(emptyStateOf(dropsOnly('A', 'B'), filter({ search: 'a' }))).toEqual(hidden);
    // Тип тоже учитывается: дроп подходит и к поиску, и к отметке.
    expect(emptyStateOf(mixed, filter({ search: 'drop', categories: ['Tool'] }))).toEqual(hidden);
    expect(emptyStateOf(mixed, filter({ categories: ['Tool'] }))).toEqual(hidden);
  });

  it('keeps «nothing found» when even the hidden items would not match, or showing them is on', () => {
    const nothing = { text: 'grid.nothingFound', action: 'reset' };
    const mixed: Inventory = { skins: [drop('Drop A'), skin('Plain B')], unreadable: [] };
    // Дроп не подходит к поиску или к типу.
    expect(emptyStateOf(mixed, filter({ search: 'zzz' }))).toEqual(nothing);
    expect(emptyStateOf(mixed, filter({ search: 'drop', categories: ['Tool'] }))).toEqual(nothing);
    // «Стопки» и «Можно собрать» дроп не покажут, даже если показать непередаваемые.
    expect(emptyStateOf(mixed, filter({ search: 'drop', show: 'stacks' }))).toEqual(nothing);
    expect(emptyStateOf(mixed, filter({ search: 'drop', show: 'dupes' }))).toEqual(nothing);
    // Непередаваемые уже показаны.
    expect(emptyStateOf(mixed, filter({ search: 'zzz', untradable: true }))).toEqual(nothing);
  });

  it('keeps the earlier cases ahead of the hidden match', () => {
    expect(emptyStateOf(dropsOnly('A'), filter())).toEqual({ text: 'grid.onlyUntradable', action: 'showUntradable' });
    expect(emptyStateOf(dropsOnly('A'), filter({ show: 'stacks' }))).toEqual({ text: 'grid.noStacks', action: 'showAll' });
    expect(emptyStateOf(inventory(), filter({ search: 'a' }))).toEqual({ text: 'grid.empty', action: null });
  });

  it('has texts for the hidden match in both languages', () => {
    setLang('ru');
    expect(t('grid.onlyHiddenMatch')).toBe('Нашлось только среди непередаваемых предметов, а они скрыты.');
    setLang('en');
    expect(t('grid.onlyHiddenMatch')).toBe('Only untradable items match, and they are hidden.');
  });

  it('puts «no stacks» ahead of the untradable case and keeps «empty inventory» first', () => {
    expect(emptyStateOf(dropsOnly('A'), filter({ show: 'stacks' }))).toEqual({ text: 'grid.noStacks', action: 'showAll' });
    expect(emptyStateOf(inventory(), filter())).toEqual({ text: 'grid.empty', action: null });
  });

  it('has texts for the untradable case in both languages', () => {
    setLang('ru');
    expect(t('grid.onlyUntradable')).toBe('Здесь только предметы, которые нельзя передать: дропы Twitch и подобные. Делить и собирать в них нечего.');
    expect(t('grid.showUntradable')).toBe('Показать их');
    setLang('en');
    expect(t('grid.onlyUntradable')).toBe(
      "Only items that can't be traded are here: Twitch drops and the like. There is nothing to split or combine in them.",
    );
    expect(t('grid.showUntradable')).toBe('Show them');
  });
});

describe('banner buttons while something runs', () => {
  const idle: Panel = { kind: 'selection' };
  const running: Panel = {
    kind: 'running',
    plan: { operation: { kind: 'splitAll' }, requests: 4, stacks: 1, queue: [], more: 0, after: [] },
    done: 0,
    total: 4,
    errors: 0,
    key: '',
    processed: [],
    waitUntil: null,
    stopping: false,
  };

  it('work when nothing runs and nothing is read', () => {
    expect(bannerBusy(idle, false)).toBe(false);
  });

  it('are off during a run and during a read, so a retry cannot start a second read over the first', () => {
    expect(bannerBusy(running, false)).toBe(true);
    expect(bannerBusy(idle, true)).toBe(true);
    expect(bannerBusy(running, true)).toBe(true);
  });
});

describe('error banner', () => {
  it('offers a new token when the token expired, whatever the error', () => {
    expect(bannerActionOf(true, null)).toBe('newToken');
    expect(bannerActionOf(true, { code: 'zoomFailed', status: null })).toBe('newToken');
  });

  it('re-reads the inventory after an error of Steam or the core', () => {
    expect(bannerActionOf(false, { code: 'network', status: null })).toBe('retry');
    expect(bannerActionOf(false, { code: 'http', status: 500 })).toBe('retry');
    // Чтение оборвала «Остановить»: «Повторить» запускает его заново.
    expect(bannerActionOf(false, { code: 'stopped', status: null })).toBe('retry');
  });

  it('only closes the banner of a scale error: re-reading the inventory would not help', () => {
    expect(bannerActionOf(false, { code: 'zoomFailed', status: null })).toBe('dismiss');
  });

  it('has no banner without an error', () => {
    expect(bannerActionOf(false, null)).toBeNull();
  });

  it('names the close button in both languages', () => {
    setLang('ru');
    expect(t('banner.dismiss')).toBe('Закрыть');
    setLang('en');
    expect(t('banner.dismiss')).toBe('Dismiss');
  });
});

describe('untradable switch texts', () => {
  it('names the checkbox, its hint and the line of the totals', () => {
    setLang('ru');
    expect(t('filters.untradable')).toBe('Нельзя передать');
    expect(t('filters.untradableHint')).toBe('Дропы Twitch и другие предметы, которые нельзя передать. Делить и собирать в них нечего.');
    expect(t('stats.untradable')).toBe('Нельзя передать');
    setLang('en');
    expect(t('filters.untradable')).toBe('Untradable');
    expect(t('filters.untradableHint')).toBe(
      "Twitch drops and other items that can't be traded. There is nothing to split or combine in them.",
    );
    expect(t('stats.untradable')).toBe('Untradable');
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

describe('icons to prefetch', () => {
  const withIcon = (key: string, icon: string | null): Skin => ({ ...skin(key), icon });

  it('takes the hashes in grid order, starting right after the last drawn card', () => {
    const list = [withIcon('a', 'ha'), withIcon('b', 'hb'), withIcon('c', 'hc'), withIcon('d', 'hd')];
    expect(iconsAfter(list, 0)).toEqual(['ha', 'hb', 'hc', 'hd']);
    expect(iconsAfter(list, 2)).toEqual(['hc', 'hd']);
  });

  it('skips skins without a picture', () => {
    const list = [withIcon('a', 'ha'), withIcon('b', null), withIcon('c', 'hc')];
    expect(iconsAfter(list, 0)).toEqual(['ha', 'hc']);
  });

  it('gives nothing when everything is already drawn', () => {
    const list = [withIcon('a', 'ha'), withIcon('b', 'hb')];
    expect(iconsAfter(list, 2)).toEqual([]);
    expect(iconsAfter(list, 5)).toEqual([]);
    expect(iconsAfter([], 0)).toEqual([]);
  });
});
