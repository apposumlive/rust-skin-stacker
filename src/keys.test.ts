import { describe, expect, it } from 'vitest';
import { isReloadKey, type KeyLike } from './keys';

const key = (over: Partial<KeyLike>): KeyLike => ({ key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, ...over });

describe('reload keys', () => {
  it('catches F5 and Ctrl+F5', () => {
    expect(isReloadKey(key({ key: 'F5', code: 'F5' }))).toBe(true);
    expect(isReloadKey(key({ key: 'F5', code: 'F5', ctrlKey: true }))).toBe(true);
  });

  it('catches Ctrl+R, Ctrl+Shift+R and Cmd+R in any layout', () => {
    expect(isReloadKey(key({ key: 'r', code: 'KeyR', ctrlKey: true }))).toBe(true);
    expect(isReloadKey(key({ key: 'R', code: 'KeyR', ctrlKey: true }))).toBe(true);
    expect(isReloadKey(key({ key: 'r', code: 'KeyR', metaKey: true }))).toBe(true);
    // Русская раскладка: на клавише R буква «к».
    expect(isReloadKey(key({ key: 'к', code: 'KeyR', ctrlKey: true }))).toBe(true);
  });

  it('lets typing, pasting and other shortcuts through', () => {
    expect(isReloadKey(key({ key: 'r', code: 'KeyR' }))).toBe(false);
    expect(isReloadKey(key({ key: 'v', code: 'KeyV', ctrlKey: true }))).toBe(false);
    expect(isReloadKey(key({ key: 'a', code: 'KeyA', ctrlKey: true }))).toBe(false);
    expect(isReloadKey(key({ key: 'r', code: 'KeyR', ctrlKey: true, altKey: true }))).toBe(false);
    expect(isReloadKey(key({ key: 'ContextMenu', code: 'ContextMenu' }))).toBe(false);
  });
});
