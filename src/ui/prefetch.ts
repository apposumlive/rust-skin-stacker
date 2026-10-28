// Подгрузка картинок наперёд. Сетка виртуальная: картинка ряда начинает грузиться, только когда ряд нарисован.
// Подгрузчик заранее просит те же адреса, что у карточек, и браузер потом берёт картинки из кэша.

import { iconUrl } from '../format';
import { CARD_IMAGE_SIZE } from './item-image';

export interface Prefetcher {
  /** Отменяет прошлую подгрузку и через задержку начинает грузить картинки по порядку. */
  start(hashes: string[]): void;
  /** Останавливает ожидание и новые загрузки; уже начатые не обрываются. */
  cancel(): void;
}

export interface PrefetchOptions {
  /** Сколько загрузок идёт одновременно. */
  concurrency?: number;
  /** Сколько картинок берётся за один `start`. */
  limit?: number;
  /** Пауза перед началом, чтобы не мешать картинкам на экране. */
  delayMs?: number;
}

/** Через сколько миллисекунд зависшая загрузка считается законченной. */
export const IMAGE_TIMEOUT = 20_000;

/**
 * Боевая загрузка: картинка уходит в кэш браузера. Ошибка — тоже конец загрузки: подгрузка не ошибается.
 * Зависший запрос через IMAGE_TIMEOUT тоже считается законченным и не держит место подгрузки.
 */
export function loadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, IMAGE_TIMEOUT);
    img.onload = done;
    img.onerror = done;
    img.src = url;
  });
}

export function createPrefetcher(load: (url: string) => Promise<void>, options: PrefetchOptions = {}): Prefetcher {
  const { concurrency = 4, limit = 400, delayMs = 1500 } = options;
  // Запрошенные хэши помним, пока жив подгрузчик (окно): второй раз тот же адрес не просим.
  const requested = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Текущий запуск; `null` — ничего не ждёт. Идущие загрузки общие для запусков, чтобы после
  // перезапуска их вместе с новыми не оказалось больше `concurrency`.
  let run: { hashes: string[]; next: number; started: number } | null = null;
  let active = 0;

  const pump = () => {
    while (run && active < concurrency && run.started < limit && run.next < run.hashes.length) {
      const hash = run.hashes[run.next++];
      if (requested.has(hash)) continue;
      requested.add(hash);
      run.started += 1;
      active += 1;
      let loading: Promise<void>;
      try {
        loading = load(iconUrl(hash, CARD_IMAGE_SIZE, 0));
      } catch {
        loading = Promise.resolve();
      }
      // Ошибка одной картинки не останавливает остальные и никому не показывается.
      void loading
        .catch(() => undefined)
        .then(() => {
          active -= 1;
          pump();
        });
    }
  };

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    run = null;
  };

  return {
    start(hashes) {
      cancel();
      const list = [...hashes];
      timer = setTimeout(() => {
        timer = undefined;
        run = { hashes: list, next: 0, started: 0 };
        pump();
      }, delayMs);
    },
    cancel,
  };
}
