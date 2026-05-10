/**
 * click.ts - mirror page clicks between peers.
 *
 * Each local click broadcasts viewport-relative coordinates + the
 * sender's viewport dimensions on `viewport.click`. The remote side
 * rescales to its own viewport, finds the element under that point
 * with `elementFromPoint`, and dispatches a synthesized
 * mousedown/mouseup/click sequence so the page's handlers fire as if
 * the user had clicked.
 *
 * Echo guard: replayed clicks have `isTrusted === false`, so we just
 * ignore non-trusted events at the source. Belt-and-suspenders: every
 * click also carries a unique nonce, and on first subscribe we skip
 * the initial value so reconnects don't replay a stale click that was
 * lingering in shared state.
 *
 * Limitations: single primary-button clicks only. No drag, no double-
 * click, no modifier keys, no contextmenu. Drag-style interactions
 * (d3-brush etc.) are handled by dedicated adapters.
 */

import type { PolyApi } from '@polychrome/kiosk';

export interface ClickSnapshot {
  /** Viewport-relative click coords on the sender. */
  x: number;
  y: number;
  /** Sender viewport width/height, used to rescale on the receiver. */
  vw: number;
  vh: number;
  button: number;
  t: number;
  /** Unique per emit so subscribers see every click as fresh. */
  nonce: string;
}

export interface ClickOptions {
  api: PolyApi;
  /** Document to listen on / dispatch into. Defaults to `document`. */
  source?: Document;
  /** Window whose viewport dims to broadcast. Defaults to `window`. */
  win?: Window;
  /** Injected for tests. */
  now?: () => number;
  /** Injected for tests - random nonce. */
  nonce?: () => string;
  /**
   * Predicate that decides whether a click came from real user input
   * (and so should be broadcast). Defaults to `ev.isTrusted`, which
   * is what real browsers use to distinguish user input from
   * `dispatchEvent`. Injected for jsdom tests, where `isTrusted` is
   * non-configurable.
   */
  isUserEvent?: (ev: MouseEvent) => boolean;
}

export interface ClickHandle {
  destroy(): void;
}

export const CLICK_KEY = 'viewport.click';

export function installClickSync(opts: ClickOptions): ClickHandle {
  const source = opts.source ?? document;
  const win = opts.win ?? window;
  const now = opts.now ?? Date.now;
  const nonce = opts.nonce ?? (() => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const isUserEvent = opts.isUserEvent ?? ((ev: MouseEvent): boolean => ev.isTrusted);
  const handle = opts.api.share<ClickSnapshot>(CLICK_KEY);

  function onClick(ev: MouseEvent): void {
    // Synthesized replays come back through this same listener; ignore
    // them via the standard isTrusted gate. Real user input is the
    // only thing we forward.
    if (!isUserEvent(ev)) return;
    if (ev.button !== 0) return;
    handle.set({
      x: ev.clientX,
      y: ev.clientY,
      vw: win.innerWidth || 1,
      vh: win.innerHeight || 1,
      button: ev.button,
      t: now(),
      nonce: nonce(),
    });
  }

  // Capture phase: see the click before page handlers can stopPropagation it.
  source.addEventListener('click', onClick, true);

  // Skip the initial snapshot replay - subscribe() fires cb synchronously
  // with any existing value, but that's an old click we shouldn't re-fire.
  let primed = false;
  const unsub = handle.subscribe((snap) => {
    if (!primed || !snap) return;
    const localVw = win.innerWidth || snap.vw || 1;
    const localVh = win.innerHeight || snap.vh || 1;
    const x = snap.vw > 0 ? snap.x * (localVw / snap.vw) : snap.x;
    const y = snap.vh > 0 ? snap.y * (localVh / snap.vh) : snap.y;
    const target = source.elementFromPoint(x, y);
    if (!target) return;
    dispatchClick(target, x, y, snap.button);
  });
  primed = true;

  return {
    destroy(): void {
      source.removeEventListener('click', onClick, true);
      unsub();
    },
  };
}

function dispatchClick(target: Element, x: number, y: number, button: number): void {
  // Note: deliberately omit `view` (jsdom rejects the cross-realm proxy
  // its `defaultView` returns, and real browsers default to the
  // current window when omitted).
  const base = { bubbles: true, cancelable: true, button, clientX: x, clientY: y } as const;
  target.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
  target.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
  target.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));
}
