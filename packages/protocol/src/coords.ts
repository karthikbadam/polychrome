/**
 * @polychrome/protocol - coords.ts
 *
 * Coordinate normalization helpers.
 *
 * All x, y in DomEventPayload and CursorMovePayload are in the ideal
 * viewport of 1920 × 1080.  The capture side calls toIdeal; the dispatch
 * side calls fromIdeal before elementFromPoint.
 */

export const IDEAL_W = 1920 as const;
export const IDEAL_H = 1080 as const;

export interface ViewportRect {
  x: number;
  y: number;
  w: number; // window.innerWidth on the originating peer
  h: number; // window.innerHeight on the originating peer
}

/**
 * Convert a native (viewport-relative) point to ideal coords.
 *
 * @param point  The native point plus the viewport dimensions at capture time.
 * @returns      The point rescaled to the 1920×1080 ideal space.
 */
export function toIdeal(point: ViewportRect): { x: number; y: number } {
  return {
    x: (point.x * IDEAL_W) / point.w,
    y: (point.y * IDEAL_H) / point.h,
  };
}

/**
 * Convert an ideal-coord point back to native coords for this viewport.
 *
 * @param point  The ideal point plus the current viewport dimensions.
 * @returns      The point rescaled to native viewport coordinates.
 */
export function fromIdeal(point: ViewportRect): { x: number; y: number } {
  return {
    x: (point.x * point.w) / IDEAL_W,
    y: (point.y * point.h) / IDEAL_H,
  };
}
