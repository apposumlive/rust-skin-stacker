// Картинка предмета: одна функция для карточки, большой картинки панели и миниатюр.

import { h, icon } from '../dom';
import { ICON_HOSTS, iconUrl } from '../format';

/** Размер картинки карточки сетки. Подгрузка наперёд просит тот же адрес, поэтому размер общий. */
export const CARD_IMAGE_SIZE = 128;

const noPicture = () => icon('photo-off');

/**
 * Предмет с хэшем — `<img>` с основного CDN; не отдал — пробуем запасной, не отдал и он — значок.
 * Класс `loaded` включает плавное появление (стили): до него видна спокойная плитка-подложка.
 */
export function itemImage(hash: string | null, size: number): HTMLElement {
  if (!hash) return noPicture();
  let host = 0;
  const img = h('img', { src: iconUrl(hash, size, host), alt: '', decoding: 'async', draggable: 'false' });
  img.addEventListener('load', () => img.classList.add('loaded'));
  img.addEventListener('error', () => {
    host += 1;
    if (host < ICON_HOSTS.length) img.src = iconUrl(hash, size, host);
    else img.replaceWith(noPicture());
  });
  // Картинка из кэша в памяти бывает готова сразу, до первого события.
  if (img.complete && img.naturalWidth > 0) img.classList.add('loaded');
  return img;
}
