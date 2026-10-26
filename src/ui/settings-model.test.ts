import { describe, expect, it } from 'vitest';
import { canRestoreFocus, nextFocusIndex, snapDelay } from './settings-model';

describe('snapDelay', () => {
  it('rounds to the nearest 500 ms', () => {
    expect(snapDelay(499)).toBe(500);
    expect(snapDelay(1234)).toBe(1000);
    expect(snapDelay(1250)).toBe(1500);
    expect(snapDelay(3000)).toBe(3000);
  });

  it('keeps the value inside 500..10000', () => {
    expect(snapDelay(0)).toBe(500);
    expect(snapDelay(-700)).toBe(500);
    expect(snapDelay(10_001)).toBe(10_000);
    expect(snapDelay(Infinity)).toBe(10_000);
    expect(snapDelay(-Infinity)).toBe(500);
  });

  it('falls back to the default for NaN', () => {
    expect(snapDelay(NaN)).toBe(1500);
  });
});

describe('nextFocusIndex', () => {
  it('moves Tab forward and wraps from the last to the first', () => {
    expect(nextFocusIndex(0, 4, false)).toBe(1);
    expect(nextFocusIndex(2, 4, false)).toBe(3);
    expect(nextFocusIndex(3, 4, false)).toBe(0);
  });

  it('moves Shift+Tab back and wraps from the first to the last', () => {
    expect(nextFocusIndex(3, 4, true)).toBe(2);
    expect(nextFocusIndex(1, 4, true)).toBe(0);
    expect(nextFocusIndex(0, 4, true)).toBe(3);
  });

  it('pulls focus into the panel when it is outside (index -1)', () => {
    expect(nextFocusIndex(-1, 4, false)).toBe(0);
    expect(nextFocusIndex(-1, 4, true)).toBe(3);
  });

  it('stays on the only element', () => {
    expect(nextFocusIndex(0, 1, false)).toBe(0);
    expect(nextFocusIndex(0, 1, true)).toBe(0);
  });

  it('has nowhere to go without focusable elements', () => {
    expect(nextFocusIndex(-1, 0, false)).toBe(-1);
    expect(nextFocusIndex(-1, 0, true)).toBe(-1);
  });

  it('never leaves the panel in a full loop of Tab or Shift+Tab', () => {
    for (const shift of [false, true]) {
      let index = -1;
      const seen = new Set<number>();
      for (let step = 0; step < 12; step += 1) {
        index = nextFocusIndex(index, 5, shift);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(5);
        seen.add(index);
      }
      expect(seen.size).toBe(5);
    }
  });
});

describe('canRestoreFocus', () => {
  const shown = { isConnected: true, hidden: false, getClientRects: () => [{}] };
  // BODY сам по себе «виден и в документе», но фокус на нём ничего не даёт.
  const body = { ...shown };

  it('accepts a connected visible element', () => {
    expect(canRestoreFocus(shown, body)).toBe(true);
  });

  it('rejects nothing and BODY', () => {
    expect(canRestoreFocus(null, body)).toBe(false);
    expect(canRestoreFocus(body, body)).toBe(false);
  });

  it('rejects a removed, hidden or not rendered element', () => {
    expect(canRestoreFocus({ ...shown, isConnected: false }, body)).toBe(false);
    expect(canRestoreFocus({ ...shown, hidden: true }, body)).toBe(false);
    expect(canRestoreFocus({ ...shown, getClientRects: () => [] }, body)).toBe(false);
  });
});
