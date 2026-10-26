import { describe, expect, it } from 'vitest';
import { columnsFor, visibleRange } from './virtual';

describe('virtual grid', () => {
  it('fits as many columns as the width allows', () => {
    expect(columnsFor(712)).toBe(4);
    expect(columnsFor(700)).toBe(3);
    expect(columnsFor(100)).toBe(1);
    expect(columnsFor(0)).toBe(1);
  });

  it('renders the visible rows plus two spare rows', () => {
    expect(visibleRange(5000, 4, 204, 0, 600)).toEqual({ first: 0, last: 20, padTop: 0, total: 255000 });
    expect(visibleRange(5000, 4, 204, 2040, 600)).toEqual({ first: 32, last: 60, padTop: 1632, total: 255000 });
  });

  it('stops at the end of the list', () => {
    const r = visibleRange(5000, 4, 204, 255000 - 600, 600);
    expect(r.last).toBe(5000);
    expect(r.first).toBe(4980);
    expect(visibleRange(10, 4, 204, 0, 5000)).toEqual({ first: 0, last: 10, padTop: 0, total: 612 });
  });

  it('handles an empty list', () => {
    expect(visibleRange(0, 4, 204, 0, 600)).toEqual({ first: 0, last: 0, padTop: 0, total: 0 });
  });
});
