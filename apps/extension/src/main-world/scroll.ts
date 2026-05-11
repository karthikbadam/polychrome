/**
 * scroll.ts - mirror page scroll position between peers.
 *
 * Local scroll position is throttled (default 50ms = ~20Hz) and
 * published to the shared polychrome surface as
 * `viewport.scroll = { x, y, docW, docH, t }`. Remote arrivals call
 * `window.scrollTo`, rescaling by the sender's doc dimensions so two
 * peers with different window sizes stay roughly proportional.
 *
 * Echo guard: after applying a remote snapshot the browser fires a
 * synthetic `scroll` event, which would otherwise rebroadcast. We
 * suppress local broadcasts for a short window after each remote
 * apply using a timestamp gate (rather than a synchronous flag,
 * because scroll-event timing varies between engines).
 */

import type { PolyApi } from '@polychrome/kiosk';

import { makeThrottle } from './cursors.js';

export interface ScrollSnapshot {
  x: number;
  y: number;
  /** Sender's documentElement scroll dimensions, for cross-peer rescaling. */
  docW: number;
  docH: number;
  t: number;
}

export interface ScrollOptions {
  api: PolyApi;
  /** Window the scroll events come from. Defaults to `window`. */
  source?: Window;
  /** Throttle interval in ms. */
  throttleMs?: number;
  /** Suppress local broadcasts for this many ms after a remote apply. */
  suppressMs?: number;
  /** Injected for tests. */
  now?: () => number;
}

export interface ScrollHandle {
  destroy(): void;
}

export const SCROLL_KEY = 'viewport.scroll';

export function installScrollSync(opts: ScrollOptions): ScrollHandle {
  const source = opts.source ?? window;
  const throttleMs = opts.throttleMs ?? 50;
  const suppressMs = opts.suppressMs ?? 250;
  const now = opts.now ?? Date.now;
  const handle = opts.api.share<ScrollSnapshot>(SCROLL_KEY);

  // Timestamp-based echo gate: programmatic scrollTo dispatches a
  // synthetic scroll event whose timing varies. Anything inside this
  // window is treated as our own replay and not rebroadcast.
  let suppressUntil = 0;

  const send = makeThrottle<ScrollSnapshot>((snap) => {
    handle.set(snap);
  }, throttleMs, now);

  function snapshot(): ScrollSnapshot | null {
    const doc = source.document?.documentElement;
    if (!doc) return null;
    return {
      x: source.scrollX,
      y: source.scrollY,
      docW: doc.scrollWidth,
      docH: doc.scrollHeight,
      t: now(),
    };
  }

  function onScroll(): void {
    if (now() < suppressUntil) return;
    const snap = snapshot();
    if (!snap) return;
    send.call(snap);
  }

  source.addEventListener('scroll', onScroll, { passive: true });

  const unsub = handle.subscribe((snap) => {
    if (!snap) return;
    const doc = source.document?.documentElement;
    if (!doc) return;
    const localW = doc.scrollWidth || 1;
    const localH = doc.scrollHeight || 1;
    const sx = snap.docW > 0 ? snap.x * (localW / snap.docW) : snap.x;
    const sy = snap.docH > 0 ? snap.y * (localH / snap.docH) : snap.y;
    suppressUntil = now() + suppressMs;
    try { source.scrollTo({ left: sx, top: sy, behavior: 'auto' }); }
    catch { /* old engines without options form */ source.scrollTo(sx, sy); }
  });

  return {
    destroy(): void {
      send.flush();
      source.removeEventListener('scroll', onScroll);
      unsub();
    },
  };
}
