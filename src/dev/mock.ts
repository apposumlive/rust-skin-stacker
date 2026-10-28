// Демо-режим для `npm run dev` в обычном браузере. Названия и картинки настоящие
// (как на макетах docs/design/), количества выдуманы. В сборку Tauri не попадает:
// main.ts подключает его только при import.meta.env.DEV и без Tauri.

import type { Api } from '../api';
import type { Inventory, InvRecord, Operation, Plan, Progress, Settings, Skin, SkinAfter } from '../types';
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
function demoQueue(inventory: Inventory, operation: Operation): { requests: number; queue: Plan['queue']; after: SkinAfter[] } {
  const keys =
    operation.kind === 'splitSelected' || operation.kind === 'combineSelected'
      ? new Set(operation.keys)
      : operation.kind === 'splitOff'
        ? new Set([operation.key])
        : null;
  const skins = inventory.skins
    .filter((s) => !keys || keys.has(s.key))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const split = operation.kind === 'splitAll' || operation.kind === 'splitSelected' || operation.kind === 'splitOff';
  let requests = 0;
  const queue: Plan['queue'] = [];
  const after: SkinAfter[] = [];
  for (const skin of skins) {
    if (split) {
      let left = operation.kind === 'splitOff' ? operation.count : Infinity;
      let singles = 0;
      const stacks: number[] = [];
      const startRequests = requests;
      for (const record of skin.records) {
        const n = Math.min(record.amount - 1, left);
        left -= n;
        requests += n;
        singles += n;
        if (n > 0) queue.push({ key: skin.key, amount: record.amount, requests: n });
        if (record.amount - n === 1) singles += 1;
        else stacks.push(record.amount - n);
      }
      if (requests > startRequests) after.push({ key: skin.key, stacks: stacks.sort((a, b) => b - a), singles });
    } else if (skin.records.length > 1) {
      requests += skin.records.length - 1;
      queue.push({ key: skin.key, amount: skin.total, requests: skin.records.length - 1 });
      after.push({ key: skin.key, stacks: skin.total > 1 ? [skin.total] : [], singles: skin.total > 1 ? 0 : 1 });
    }
  }
  return { requests, queue, after };
}

function demoPlan(inventory: Inventory, operation: Operation): Plan {
  const { requests, queue, after } = demoQueue(inventory, operation);
  return { operation, requests, stacks: queue.length, queue: queue.slice(0, 5), more: Math.max(0, queue.length - 5), after };
}

/** Ключ скина каждого шага по порядку — как шаги ядра. */
const demoSteps = (inventory: Inventory, operation: Operation): string[] =>
  demoQueue(inventory, operation).queue.flatMap((item) => Array<string>(item.requests).fill(item.key));

function applyPlan(inventory: Inventory, plan: Plan): Inventory {
  const byKey = new Map(plan.after.map((a) => [a.key, a]));
  let id = 5000;
  const skins = inventory.skins.map((skin) => {
    const after = byKey.get(skin.key);
    const base = skin.records[0];
    if (!after || !base) return skin;
    const amounts = [...after.stacks, ...Array<number>(after.singles).fill(1)];
    return { ...skin, records: amounts.map((amount) => ({ ...base, assetid: String(++id), amount })) };
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
