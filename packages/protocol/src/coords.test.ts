/**
 * coords.test.ts - round-trip property tests for toIdeal / fromIdeal
 */
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { IDEAL_H, IDEAL_W, fromIdeal, toIdeal } from './coords.js';

describe('coords constants', () => {
  it('IDEAL_W is 1920', () => {
    expect(IDEAL_W).toBe(1920);
  });

  it('IDEAL_H is 1080', () => {
    expect(IDEAL_H).toBe(1080);
  });
});

describe('toIdeal / fromIdeal round-trip', () => {
  it('round-trips to within 1px (property test)', () => {
    fc.assert(
      fc.property(
        // native point
        fc.float({ min: 0, max: 3840, noNaN: true }),
        fc.float({ min: 0, max: 2160, noNaN: true }),
        // viewport dimensions (positive, non-zero)
        fc.float({ min: 1, max: 3840, noNaN: true }),
        fc.float({ min: 1, max: 2160, noNaN: true }),
        (x, y, w, h) => {
          const ideal = toIdeal({ x, y, w, h });
          const native = fromIdeal({ x: ideal.x, y: ideal.y, w, h });

          expect(Math.abs(native.x - x)).toBeLessThanOrEqual(1);
          expect(Math.abs(native.y - y)).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('toIdeal scales correctly for 1920x1080 native viewport', () => {
    const result = toIdeal({ x: 960, y: 540, w: 1920, h: 1080 });
    expect(result.x).toBeCloseTo(960, 1);
    expect(result.y).toBeCloseTo(540, 1);
  });

  it('toIdeal scales up for small viewport', () => {
    const result = toIdeal({ x: 480, y: 270, w: 960, h: 540 });
    expect(result.x).toBeCloseTo(960, 1);
    expect(result.y).toBeCloseTo(540, 1);
  });

  it('fromIdeal scales down for small viewport', () => {
    const result = fromIdeal({ x: 960, y: 540, w: 960, h: 540 });
    expect(result.x).toBeCloseTo(480, 1);
    expect(result.y).toBeCloseTo(270, 1);
  });
});
