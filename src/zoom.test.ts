import { describe, expect, it } from 'vitest';
import type { KeyLike } from './keys';
import { effectiveScale, stepScale, UI_SCALES, zoomKey } from './zoom';

describe('UI_SCALES', () => {
  it('is the list of the core settings', () => {
    expect(UI_SCALES).toEqual([100, 110, 125, 150]);
  });
});

describe('stepScale', () => {
  it('goes to the next value up and down', () => {
    expect(stepScale(100, 1)).toBe(110);
    expect(stepScale(110, 1)).toBe(125);
    expect(stepScale(125, 1)).toBe(150);
    expect(stepScale(150, -1)).toBe(125);
    expect(stepScale(125, -1)).toBe(110);
    expect(stepScale(110, -1)).toBe(100);
  });

  it('stays at the edges', () => {
    expect(stepScale(150, 1)).toBe(150);
    expect(stepScale(100, -1)).toBe(100);
  });

  it('first takes the nearest value of the list for anything else', () => {
    // 120 ближе всего к 125.
    expect(stepScale(120, 1)).toBe(150);
    expect(stepScale(120, -1)).toBe(110);
    expect(stepScale(104, 1)).toBe(110);
    expect(stepScale(400, 1)).toBe(150);
    expect(stepScale(400, -1)).toBe(125);
    expect(stepScale(0, -1)).toBe(100);
    expect(stepScale(0, 1)).toBe(110);
  });
});

describe('effectiveScale', () => {
  it('lowers 150 to 125 in a 1280×800 window and keeps 125', () => {
    expect(effectiveScale(150, 1280, 800)).toBe(125);
    expect(effectiveScale(125, 1280, 800)).toBe(125);
    expect(effectiveScale(110, 1280, 800)).toBe(110);
  });

  it('gives 100 for every choice in the smallest window, 1024×640', () => {
    for (const scale of UI_SCALES) expect(effectiveScale(scale, 1024, 640)).toBe(100);
  });

  it('keeps 150 in a big window', () => {
    expect(effectiveScale(150, 3440, 1400)).toBe(150);
    expect(effectiveScale(100, 3440, 1400)).toBe(100);
  });

  it('lets the height limit the scale before the width', () => {
    // Ширина позволяет 150 (2560 / 1,5 = 1707), высота — только 125 (800 / 1,25 = 640).
    expect(effectiveScale(150, 2560, 800)).toBe(125);
    // 700 / 1,1 = 636 < 640: только 100.
    expect(effectiveScale(150, 2560, 700)).toBe(100);
  });

  it('never goes above the choice or below 100', () => {
    expect(effectiveScale(120, 3440, 1400)).toBe(110);
    expect(effectiveScale(50, 3440, 1400)).toBe(100);
    expect(effectiveScale(150, 800, 500)).toBe(100);
  });
});

describe('zoomKey', () => {
  const key = (over: Partial<KeyLike & { shiftKey: boolean }>) => ({
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...over,
  });

  it('makes the scale bigger with Ctrl or Cmd and = or numpad +', () => {
    expect(zoomKey(key({ key: '=', code: 'Equal', ctrlKey: true }))).toBe(1);
    // Ctrl+Shift+= — это «Ctrl++».
    expect(zoomKey(key({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }))).toBe(1);
    expect(zoomKey(key({ key: '+', code: 'NumpadAdd', ctrlKey: true }))).toBe(1);
    expect(zoomKey(key({ key: '=', code: 'Equal', metaKey: true }))).toBe(1);
  });

  it('makes it smaller with − or numpad −', () => {
    expect(zoomKey(key({ key: '-', code: 'Minus', ctrlKey: true }))).toBe(-1);
    expect(zoomKey(key({ key: '-', code: 'NumpadSubtract', ctrlKey: true }))).toBe(-1);
  });

  it('resets it with 0 or numpad 0', () => {
    expect(zoomKey(key({ key: '0', code: 'Digit0', ctrlKey: true }))).toBe(0);
    expect(zoomKey(key({ key: '0', code: 'Numpad0', ctrlKey: true }))).toBe(0);
  });

  it('goes by the physical key, so another layout works the same', () => {
    expect(zoomKey(key({ key: 'ъ', code: 'Equal', ctrlKey: true }))).toBe(1);
    expect(zoomKey(key({ key: 'ь', code: 'Minus', ctrlKey: true }))).toBe(-1);
    expect(zoomKey(key({ key: ')', code: 'Digit0', ctrlKey: true }))).toBe(0);
    // Буква «=» на другой физической клавише масштаб не трогает.
    expect(zoomKey(key({ key: '=', code: 'BracketRight', ctrlKey: true }))).toBeNull();
  });

  it('ignores the keys with Alt or without Ctrl/Cmd', () => {
    expect(zoomKey(key({ key: '=', code: 'Equal', ctrlKey: true, altKey: true }))).toBeNull();
    expect(zoomKey(key({ key: '0', code: 'Digit0', ctrlKey: true, altKey: true }))).toBeNull();
    expect(zoomKey(key({ key: '=', code: 'Equal' }))).toBeNull();
    expect(zoomKey(key({ key: '-', code: 'Minus' }))).toBeNull();
    expect(zoomKey(key({ key: '0', code: 'Digit0' }))).toBeNull();
  });

  it('ignores other shortcuts', () => {
    expect(zoomKey(key({ key: 'r', code: 'KeyR', ctrlKey: true }))).toBeNull();
    expect(zoomKey(key({ key: '1', code: 'Digit1', ctrlKey: true }))).toBeNull();
  });
});
