// Демо-режим для `npm run dev` в обычном браузере. Названия и картинки настоящие
// (как на макетах docs/design/), количества выдуманы. В сборку Tauri не попадает:
// main.ts подключает его только при import.meta.env.DEV и без Tauri.

import type { Api } from '../api';
import type { CardAfter, Inventory, InvRecord, Operation, Plan, Progress, Settings, Skin } from '../types';
import { AUTO, UI_SCALES } from '../zoom';
import items from './demo-items.json';

/** Раскладка демо-инвентаря: [стопки, сколько по одному]. */
const LAYOUT: Array<[number[], number]> = [
  [[8], 0], [[], 1], [[5, 4], 3], [[], 1], [[12], 0], [[3], 2], [[], 1], [[], 1],
  [[7], 0], [[], 2], [[], 1], [[4], 1], [[], 1], [[], 1], [[9], 0], [[], 1],
  [[2], 0], [[], 1], [[6], 0], [[], 1], [[], 1], [[3], 0], [[], 1], [[], 1],
  [[10], 0], [[], 1], [[2], 1], [[], 1], [[], 1], [[5], 0], [[], 1], [[], 1],
  [[], 1], [[4], 0], [[], 1], [[], 1], [[3], 0], [[], 1], [[], 1], [[2], 0],
];

const CATEGORIES = [
  { id: 'steamcat.weapon', label: 'Weapon' },
  { id: 'steamcat.clothing', label: 'Clothing' },
  { id: 'steamcat.construction', label: 'Construction' },
  { id: 'steamcat.tool', label: 'Tool' },
];

const iconHash = (url: string): string => url.split('/economy/image/')[1]?.split('/')[0] ?? '';

// Последние DROPS предметов — «дропы Twitch»: одна штука, не передаются и не продаются, даты нет. Они скрыты в сетке.
const DROPS = 4;
// Один одиночный предмет (не дроп) временно не передаётся: он остаётся в сетке.
const LOCKED_FOR_NOW = 1;
const LOCK_DAYS = 5;

function demoInventory(): Inventory {
  let id = 1000;
  const unlock = new Date(Date.now() + LOCK_DAYS * 24 * 3600 * 1000).toISOString();
  const skins: Skin[] = items.map((item, i) => {
    const drop = i >= items.length - DROPS;
    const [stacks, singles] = drop ? [[], 1] : LAYOUT[i % LAYOUT.length];
    const amounts = [...stacks, ...Array<number>(singles).fill(1)];
    const lockedNow = i === LOCKED_FOR_NOW;
    const records: InvRecord[] = amounts.map((amount) => ({
      assetid: String(++id),
      classid: `c${i}`,
      instanceid: '0',
      amount,
      tradable: !drop && !lockedNow,
      marketable: !drop,
      availableAfter: lockedNow ? unlock : null,
    }));
    return {
      key: item.name,
      name: item.name,
      icon: iconHash(item.icon),
      category: CATEGORIES[i % CATEGORIES.length],
      total: amounts.reduce((a, b) => a + b, 0),
      records,
    };
  });
  return { skins: skins.sort((a, b) => a.key.localeCompare(b.key)), unreadable: [] };
}

/** Упрощённая копия plan::build из ядра — только для демо. Очередь полная: по ней демо идёт шагами. */
function demoQueue(inventory: Inventory, operation: Operation): { requests: number; queue: Plan['queue']; cards: CardAfter[] } {
  const ids = (list: string[]) => new Set(list);
  const keys = operation.kind === 'combineSelected' ? new Set(operation.keys) : null;
  const chosen =
    operation.kind === 'splitRecords' || operation.kind === 'combineRecords'
      ? ids(operation.assetids)
      : operation.kind === 'splitOff'
        ? ids([operation.assetid])
        : null;
  const split = operation.kind === 'splitAll' || operation.kind === 'splitRecords' || operation.kind === 'splitOff';
  const skins = inventory.skins
    .filter((s) => !keys || keys.has(s.key))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  let requests = 0;
  const queue: Plan['queue'] = [];
  const cards: CardAfter[] = [];
  for (const skin of skins) {
    const records = skin.records.filter((r) => !chosen || chosen.has(r.assetid));
    if (split) {
      let left = operation.kind === 'splitOff' ? operation.count : Infinity;
      for (const record of records) {
        const n = Math.min(record.amount - 1, left);
        left -= n;
        if (n <= 0) continue;
        requests += n;
        queue.push({ key: skin.key, amount: record.amount, requests: n });
        cards.push({ assetid: record.assetid, amount: record.amount - n, singles: n });
      }
    } else {
      // Группы (classid, instanceid) собираются в самую большую запись группы.
      const groups = new Map<string, InvRecord[]>();
      for (const record of records) {
        const type = `${record.classid}/${record.instanceid}`;
        groups.set(type, [...(groups.get(type) ?? []), record]);
      }
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        const [target, ...rest] = [...group].sort((a, b) => b.amount - a.amount || Number(a.assetid) - Number(b.assetid));
        const sum = group.reduce((n, r) => n + r.amount, 0);
        requests += rest.length;
        queue.push({ key: skin.key, amount: sum, requests: rest.length });
        cards.push({ assetid: target.assetid, amount: sum, singles: 0 });
        for (const record of rest) cards.push({ assetid: record.assetid, amount: 0, singles: 0 });
      }
    }
  }
  return { requests, queue, cards };
}

function demoPlan(inventory: Inventory, operation: Operation): Plan {
  const { requests, queue, cards } = demoQueue(inventory, operation);
  return { operation, requests, stacks: queue.length, queue: queue.slice(0, 5), more: Math.max(0, queue.length - 5), cards };
}

/** Ключ скина каждого шага по порядку — как шаги ядра. */
const demoSteps = (inventory: Inventory, operation: Operation): string[] =>
  demoQueue(inventory, operation).queue.flatMap((item) => Array<string>(item.requests).fill(item.key));

// Номер для новых записей после разделения: общий на все запуски демо, чтобы assetid не повторялись.
let nextId = 5000;

/** Меняет инвентарь по плану: amount 0 — запись исчезла, иначе amount; singles — новые записи по одной. */
function applyPlan(inventory: Inventory, plan: Plan): Inventory {
  const byId = new Map(plan.cards.map((c) => [c.assetid, c]));
  const skins = inventory.skins.map((skin) => {
    if (!skin.records.some((r) => byId.has(r.assetid))) return skin;
    const records: InvRecord[] = [];
    for (const record of skin.records) {
      const after = byId.get(record.assetid);
      if (!after) records.push(record);
      else {
        if (after.amount > 0) records.push({ ...record, amount: after.amount });
        for (let i = 0; i < after.singles; i++) records.push({ ...record, assetid: String(++nextId), amount: 1 });
      }
    }
    records.sort((a, b) => b.amount - a.amount);
    return { ...skin, records };
  });
  return { ...inventory, skins };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createMockApi(): Api {
  let inventory = demoInventory();
  let settings: Settings = { language: null, delayMs: 1500, uiScale: AUTO };
  let listener: ((progress: Progress) => void) | null = null;
  let stopped = false;
  const log: string[] = [];

  return {
    async setToken(raw) {
      if (!raw.toLowerCase().includes('demo')) throw { code: 'tokenNotFound', status: null };
      return { steamidMasked: '7656…4821', expiresAt: Math.floor(Date.now() / 1000) + 18 * 3600 + 300 };
    },
    async forgetToken() {},
    async loadInventory() {
      await wait(600);
      // Весь демо-инвентарь — одна страница. Без задержки: снимки демо не замедляются.
      const records = inventory.skins.reduce((n, s) => n + s.records.length, 0);
      listener?.({ kind: 'reading', read: records, total: records });
      return inventory;
    },
    async preview(operation) {
      return demoPlan(inventory, operation);
    },
    async start(operation) {
      const plan = demoPlan(inventory, operation);
      const steps = demoSteps(inventory, operation);
      stopped = false;
      let done = 0;
      while (done < plan.requests && !stopped) {
        listener?.({ kind: 'request', done, total: plan.requests, errors: 0, key: steps[done] ?? '' });
        await wait(120);
        done += 1;
      }
      listener?.({ kind: 'request', done, total: plan.requests, errors: 0, key: '' });
      const before = inventory.skins.reduce((n, s) => n + s.total, 0);
      if (!stopped) inventory = applyPlan(inventory, plan);
      log.push(`demo run: ${operation.kind}, ${done} of ${plan.requests}`);
      return {
        kind: 'finished',
        outcome: { reason: stopped ? 'stoppedByUser' : 'finished', done, errors: 0, total: plan.requests },
        reconciliation: { before, after: before, mismatches: [] },
        inventory,
      };
    },
    async stop() {
      stopped = true;
    },
    async getSettings() {
      return settings;
    },
    async saveSettings(next) {
      settings = {
        language: next.language,
        delayMs: Math.min(10_000, Math.max(500, next.delayMs)),
        // Как в ядре: «Авто» или значение списка, остальное — «Авто».
        uiScale: UI_SCALES.some((scale) => scale === next.uiScale) ? next.uiScale : AUTO,
      };
      return settings;
    },
    async journal() {
      return log.join('\n');
    },
    async onProgress(callback) {
      listener = callback;
      return () => {
        listener = null;
      };
    },
    async openTokenPage() {
      window.open('https://steamcommunity.com/pointssummary/ajaxgetasyncconfig', '_blank', 'noopener');
    },
    // В обычном браузере зум окна не меняем и в журнал не пишем: только запоминаем (атрибут data-demo-zoom).
    async setZoom(factor) {
      document.documentElement.dataset.demoZoom = String(factor);
    },
    // Зума здесь нет: размер страницы и есть размер окна.
    async windowMetrics() {
      return { width: window.innerWidth, height: window.innerHeight, monitorHeight: window.screen.height };
    },
    async onWindowChange(callback) {
      const onResize = () => callback();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    },
  };
}
