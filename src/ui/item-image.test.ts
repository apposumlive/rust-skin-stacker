import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { iconUrl } from '../format';
import { byTag, FakeEl, fakeDocument, fire } from './fake-dom';
import { itemImage } from './item-image';

const asEl = (el: unknown) => el as FakeEl;

beforeEach(() => {
  vi.stubGlobal('document', fakeDocument);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Картинка в коробке, как в карточке: так видно, чем её заменят. */
function inBox(hash: string | null, size = 128) {
  const img = asEl(itemImage(hash, size));
  const box = new FakeEl('div');
  box.append(img);
  return { img, box };
}

describe('itemImage', () => {
  it('gives the photo-off icon when there is no hash', () => {
    const el = asEl(itemImage(null, 128));
    expect(el.tag).toBe('i');
    expect(el.classes.has('ti-photo-off')).toBe(true);
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('makes an <img> on the Fastly host, not lazy, not draggable', () => {
    const img = asEl(itemImage('abc_DEF-1', 128));
    expect(img.tag).toBe('img');
    expect(img.src).toBe(iconUrl('abc_DEF-1', 128, 0));
    expect(img.src).toBe('https://community.fastly.steamstatic.com/economy/image/abc_DEF-1/128fx128f');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('draggable')).toBe('false');
    expect(img.attrs.has('loading')).toBe(false);
  });

  it('uses the size it was asked for', () => {
    expect(asEl(itemImage('abc', 96)).src).toBe(iconUrl('abc', 96, 0));
  });

  it('switches to the Akamai host on the first error', () => {
    const { img, box } = inBox('abc');
    fire(img, 'error');
    expect(img.src).toBe(iconUrl('abc', 128, 1));
    expect(img.src).toBe('https://community.akamai.steamstatic.com/economy/image/abc/128fx128f');
    expect(box.children).toHaveLength(1);
    expect(box.children[0]).toBe(img);
  });

  it('puts the photo-off icon in place of the picture on the second error', () => {
    const { img, box } = inBox('abc');
    fire(img, 'error');
    fire(img, 'error');
    expect(byTag(box, 'img')).toEqual([]);
    const [only] = box.children as FakeEl[];
    expect(box.children).toHaveLength(1);
    expect(only.tag).toBe('i');
    expect(only.classes.has('ti-photo-off')).toBe(true);
  });

  it('does not retry again after the icon replaced the picture', () => {
    const { img, box } = inBox('abc');
    fire(img, 'error');
    fire(img, 'error');
    const src = img.src;
    fire(img, 'error');
    expect(img.src).toBe(src);
    expect(box.children).toHaveLength(1);
    expect((box.children[0] as FakeEl).tag).toBe('i');
  });

  it('gets the class loaded on load, and not before', () => {
    const img = asEl(itemImage('abc', 128));
    expect(img.classes.has('loaded')).toBe(false);
    fire(img, 'load');
    expect(img.classes.has('loaded')).toBe(true);
  });

  it('gets the class loaded when it loads from the fallback host', () => {
    const { img } = inBox('abc');
    fire(img, 'error');
    expect(img.classes.has('loaded')).toBe(false);
    fire(img, 'load');
    expect(img.classes.has('loaded')).toBe(true);
  });

  it('gets the class loaded at once when the picture is already ready', () => {
    const create = fakeDocument.createElement;
    vi.spyOn(fakeDocument, 'createElement').mockImplementationOnce((tag: string) => {
      const el = create(tag);
      el.complete = true;
      el.naturalWidth = 128;
      return el;
    });
    expect(asEl(itemImage('abc', 128)).classes.has('loaded')).toBe(true);
  });

  it('does not take a finished but empty picture for a loaded one', () => {
    const create = fakeDocument.createElement;
    vi.spyOn(fakeDocument, 'createElement').mockImplementationOnce((tag: string) => {
      const el = create(tag);
      el.complete = true;
      el.naturalWidth = 0;
      return el;
    });
    expect(asEl(itemImage('abc', 128)).classes.has('loaded')).toBe(false);
  });
});
