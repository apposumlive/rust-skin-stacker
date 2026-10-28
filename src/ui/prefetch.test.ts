import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { iconUrl } from '../format';
import { createPrefetcher, IMAGE_TIMEOUT, loadImage } from './prefetch';

const url = (hash: string) => iconUrl(hash, 128, 0);
const names = (count: number, prefix = 'h') => Array.from({ length: count }, (_, i) => `${prefix}${i}`);

/** Подменная загрузка: каждая висит, пока тест её не завершит, и помнит, сколько их шло одновременно. */
function manual() {
  const calls: string[] = [];
  const waiting: Array<() => void> = [];
  let active = 0;
  let peak = 0;
  const load = vi.fn((address: string) => {
    calls.push(address);
    active += 1;
    peak = Math.max(peak, active);
    return new Promise<void>((resolve) =>
      waiting.push(() => {
        active -= 1;
        resolve();
      }),
    );
  });
  return {
    load,
    calls,
    get active() {
      return active;
    },
    get peak() {
      return peak;
    },
    /** Завершает самую раннюю из идущих загрузок. */
    async finish() {
      waiting.shift()?.();
      await vi.advanceTimersByTimeAsync(0);
    },
    /** Завершает всё, что идёт, пока что-то идёт. */
    async finishAll() {
      while (waiting.length) await this.finish();
    },
  };
}

/** Подменная загрузка, которая заканчивается сразу. */
const instant = () => {
  const calls: string[] = [];
  const load = vi.fn(async (address: string) => void calls.push(address));
  return { load, calls };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createPrefetcher', () => {
  it('waits for the delay (1500 ms by default) so the pictures on screen go first', async () => {
    const { load, calls } = instant();
    createPrefetcher(load).start(['a']);
    await vi.advanceTimersByTimeAsync(1499);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([url('a')]);
  });

  it('takes the delay from the options', async () => {
    const { load, calls } = instant();
    createPrefetcher(load, { delayMs: 200 }).start(['a']);
    await vi.advanceTimersByTimeAsync(199);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
  });

  it('loads the same address the card has: the first host, 128 px', async () => {
    const { load, calls } = instant();
    createPrefetcher(load).start(['abc_DEF-1']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual(['https://community.fastly.steamstatic.com/economy/image/abc_DEF-1/128fx128f']);
  });

  it('loads in the order of the list', async () => {
    const { load, calls } = instant();
    const hashes = names(12);
    createPrefetcher(load).start(hashes);
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual(hashes.map(url));
  });

  it('never runs more than 4 loads at once by default', async () => {
    const m = manual();
    createPrefetcher(m.load).start(names(20));
    await vi.advanceTimersByTimeAsync(1500);
    expect(m.load).toHaveBeenCalledTimes(4);
    await m.finish();
    // Освободилось одно место — стартовала одна новая, не больше.
    expect(m.load).toHaveBeenCalledTimes(5);
    expect(m.active).toBe(4);
    await m.finishAll();
    expect(m.load).toHaveBeenCalledTimes(20);
    expect(m.peak).toBe(4);
  });

  it('takes the concurrency from the options', async () => {
    const m = manual();
    createPrefetcher(m.load, { concurrency: 2 }).start(names(10));
    await vi.advanceTimersByTimeAsync(1500);
    expect(m.load).toHaveBeenCalledTimes(2);
    await m.finishAll();
    expect(m.load).toHaveBeenCalledTimes(10);
    expect(m.peak).toBe(2);
  });

  it('loads at most 400 pictures per start by default', async () => {
    const { load, calls } = instant();
    createPrefetcher(load).start(names(500));
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toHaveLength(400);
    expect(calls[399]).toBe(url('h399'));
  });

  it('takes the limit from the options', async () => {
    const { load, calls } = instant();
    createPrefetcher(load, { limit: 3 }).start(names(10));
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual(['h0', 'h1', 'h2'].map(url));
  });

  it('does not ask for a hash twice, in one list or across starts', async () => {
    const { load, calls } = instant();
    const prefetch = createPrefetcher(load);
    prefetch.start(['a', 'b', 'a', 'c']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual(['a', 'b', 'c'].map(url));
    prefetch.start(['b', 'c', 'd', 'a', 'e']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual(['a', 'b', 'c', 'd', 'e'].map(url));
    prefetch.start(['a', 'e']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toHaveLength(5);
  });

  it('does nothing when cancelled before the delay is over', async () => {
    const { load } = instant();
    const prefetch = createPrefetcher(load);
    prefetch.start(names(5));
    await vi.advanceTimersByTimeAsync(1000);
    prefetch.cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(load).not.toHaveBeenCalled();
  });

  it('asks for a hash that was cancelled before it was requested when started again', async () => {
    const { load, calls } = instant();
    const prefetch = createPrefetcher(load);
    prefetch.start(['a']);
    prefetch.cancel();
    prefetch.start(['a']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual([url('a')]);
  });

  it('lets a new start replace the previous one while it waits', async () => {
    const { load, calls } = instant();
    const prefetch = createPrefetcher(load);
    prefetch.start(['a', 'b']);
    await vi.advanceTimersByTimeAsync(1000);
    prefetch.start(['c', 'd']);
    // Задержка считается заново: от первого start уже прошло бы 1500.
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual(['c', 'd'].map(url));
  });

  it('drops what is left of the previous start when a new one comes', async () => {
    const m = manual();
    const prefetch = createPrefetcher(m.load, { concurrency: 2 });
    prefetch.start(names(6, 'old'));
    await vi.advanceTimersByTimeAsync(1500);
    expect(m.calls).toEqual(['old0', 'old1'].map(url));
    prefetch.start(names(2, 'new'));
    // Начатые не обрываем, но новых из старого списка не берём.
    await m.finishAll();
    await vi.advanceTimersByTimeAsync(1500);
    await m.finishAll();
    expect(m.calls).toEqual(['old0', 'old1', 'new0', 'new1'].map(url));
  });

  it('keeps the concurrency across a restart while earlier loads are still running', async () => {
    const m = manual();
    const prefetch = createPrefetcher(m.load);
    prefetch.start(names(4, 'old'));
    await vi.advanceTimersByTimeAsync(1500);
    expect(m.active).toBe(4);
    prefetch.start(names(4, 'new'));
    await vi.advanceTimersByTimeAsync(1500);
    // Старые четыре всё ещё идут: новые ждут, а не идут пятой-восьмой.
    expect(m.load).toHaveBeenCalledTimes(4);
    await m.finishAll();
    expect(m.load).toHaveBeenCalledTimes(8);
    expect(m.peak).toBe(4);
  });

  it('starts nothing new after cancel, and does not break loads already running', async () => {
    const m = manual();
    const prefetch = createPrefetcher(m.load, { concurrency: 2 });
    prefetch.start(names(6));
    await vi.advanceTimersByTimeAsync(1500);
    expect(m.load).toHaveBeenCalledTimes(2);
    prefetch.cancel();
    await m.finishAll();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(m.load).toHaveBeenCalledTimes(2);
  });

  it('goes on when one load fails, and does not show it', async () => {
    const calls: string[] = [];
    const load = vi.fn(async (address: string) => {
      calls.push(address);
      if (address === url('b')) throw new Error('boom');
    });
    createPrefetcher(load).start(['a', 'b', 'c', 'd']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual(['a', 'b', 'c', 'd'].map(url));
  });

  it('does not lose a slot to a failed load, whether it throws at once or rejects later', async () => {
    // Первые восемь падают (по очереди: сразу и позже), больше, чем мест, — застрять можно, только потеряв место.
    const calls: string[] = [];
    const load = vi.fn((address: string): Promise<void> => {
      calls.push(address);
      if (calls.length > 8) return Promise.resolve();
      if (calls.length % 2) throw new Error('sync');
      return Promise.reject(new Error('async'));
    });
    createPrefetcher(load).start(names(12));
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual(names(12).map(url));
  });

  it('does not retry a failed hash on the next start', async () => {
    const load = vi.fn(async () => {
      throw new Error('boom');
    });
    const prefetch = createPrefetcher(load);
    prefetch.start(['a']);
    await vi.advanceTimersByTimeAsync(1500);
    prefetch.start(['a']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('loadImage', () => {
  /** Картинка, у которой тест сам вызывает onload / onerror. */
  class FakeImage {
    static last: FakeImage | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = '';
    constructor() {
      FakeImage.last = this;
    }
  }

  beforeEach(() => {
    vi.stubGlobal('Image', FakeImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const watch = (promise: Promise<void>) => {
    const state = { done: false };
    void promise.then(() => {
      state.done = true;
    });
    return state;
  };

  it('ends when the picture loads or fails', async () => {
    const loaded = watch(loadImage(url('a')));
    expect(FakeImage.last?.src).toBe(url('a'));
    FakeImage.last?.onload?.();
    const failed = watch(loadImage(url('b')));
    FakeImage.last?.onerror?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(loaded.done).toBe(true);
    expect(failed.done).toBe(true);
  });

  it('counts a request that hangs for 20 s as finished, so it does not hold a prefetch slot', async () => {
    expect(IMAGE_TIMEOUT).toBe(20_000);
    const hanging = watch(loadImage(url('a')));
    await vi.advanceTimersByTimeAsync(IMAGE_TIMEOUT - 1);
    expect(hanging.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(hanging.done).toBe(true);
  });
});
