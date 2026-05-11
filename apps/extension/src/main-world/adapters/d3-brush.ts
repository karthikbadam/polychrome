/**
 * d3-brush.ts - DOM-level mirror for d3-brush widgets.
 *
 * Most d3-driven viz pages (Mosaic, vgplot, Vega, bl.ocks, plain d3)
 * end up rendering a d3-brush as an SVG group with this structure:
 *
 *   <g class="brush">
 *     <rect class="overlay" ... />
 *     <rect class="selection" x y width height [display:none when empty] />
 *     <rect class="handle handle--n" />
 *     <rect class="handle handle--s" />
 *     ...
 *   </g>
 *
 * The adapter:
 *   1. Discovers every g.brush in document order.
 *   2. Watches each one for selection-rect attribute changes (the d3
 *      brush updates rect.selection's x/y/width/height as the user
 *      drags).
 *   3. Broadcasts the snapshot as `brush.<index>` via the page's
 *      polychrome handle. Snapshot includes the overlay's box so the
 *      remote can interpret coordinates correctly.
 *   4. On a remote update, replays the brush by dispatching mousedown/
 *      mousemove/mouseup over the overlay rect at the right page-pixel
 *      coordinates. d3-brush listens for mousedown.brush and drives
 *      its state machine + fires 'brush'/'end' events normally - the
 *      page's downstream selection / re-render logic runs as if the
 *      user had dragged.
 *
 * Identity: we use document-order index. Two peers viewing the same
 * page after it finishes rendering should agree on the brush ordering.
 * If brushes appear async (Mosaic renders plots after data loads), the
 * adapter's MutationObserver picks them up and registers them on the
 * fly.
 */

import type { SiteAdapter, AdapterContext } from './types.js';

// ---------------------------------------------------------------------------
// Pure helpers (testable in jsdom)
// ---------------------------------------------------------------------------

export interface BrushSnapshot {
  /** Selection rect [x, y, width, height] in overlay-local coords. Null when no selection. */
  sel: [number, number, number, number] | null;
  /** Overlay rect dimensions, used for cross-peer rescaling. */
  ow: number;
  oh: number;
}

/**
 * Find every d3-brush-like group in document order.
 *
 * d3-brush itself ships groups with `class="brush"`, but consumers
 * (Mosaic plot marks, vgplot intervalX/Y/XY, plenty of bespoke
 * code) often use a different class while keeping the
 * `rect.overlay` + `rect.selection` child structure intact. Match
 * structurally: any `<g>` that contains both children is a brush.
 */
export function findBrushGroups(root: ParentNode = document): SVGGElement[] {
  const out: SVGGElement[] = [];
  const seen = new Set<SVGGElement>();
  for (const sel of root.querySelectorAll('rect.selection')) {
    const parent = sel.parentElement;
    if (!parent || parent.tagName !== 'g' && parent.tagName !== 'G') continue;
    const g = parent as unknown as SVGGElement;
    if (seen.has(g)) continue;
    if (!parent.querySelector(':scope > rect.overlay')) continue;
    seen.add(g);
    out.push(g);
  }
  return out;
}

/** Read a brush group's current selection + overlay dimensions. */
export function readBrush(node: Element): BrushSnapshot | null {
  const overlay = node.querySelector('rect.overlay');
  if (!overlay) return null;
  const ow = +(overlay.getAttribute('width') ?? '0');
  const oh = +(overlay.getAttribute('height') ?? '0');

  const sel = node.querySelector('rect.selection') as (Element & { style?: CSSStyleDeclaration }) | null;
  if (!sel) return { sel: null, ow, oh };
  if (sel.style && sel.style.display === 'none') return { sel: null, ow, oh };
  const w = +(sel.getAttribute('width') ?? '0');
  const h = +(sel.getAttribute('height') ?? '0');
  if (w <= 0 || h <= 0) return { sel: null, ow, oh };
  const x = +(sel.getAttribute('x') ?? '0');
  const y = +(sel.getAttribute('y') ?? '0');
  return { sel: [x, y, w, h], ow, oh };
}

/** Are two snapshots equivalent (avoid re-broadcasts for no-op DOM changes)? */
export function snapshotsEqual(a: BrushSnapshot | null, b: BrushSnapshot | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.ow !== b.ow || a.oh !== b.oh) return false;
  if (a.sel === b.sel) return true;
  if (!a.sel || !b.sel) return false;
  return a.sel[0] === b.sel[0] && a.sel[1] === b.sel[1] && a.sel[2] === b.sel[2] && a.sel[3] === b.sel[3];
}

// ---------------------------------------------------------------------------
// Mouse-event replay (drives d3-brush's state machine)
// ---------------------------------------------------------------------------

function dispatchMouse(target: Element, type: string, clientX: number, clientY: number): void {
  // Note: deliberately do NOT pass `view`. jsdom rejects the cross-realm
  // proxy returned by ownerDocument.defaultView; real browsers also
  // default `view` to the current window when omitted.
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === 'mouseup' ? 0 : 1,
    clientX,
    clientY,
  });
  target.dispatchEvent(e);
}

/**
 * Drive a d3-brush programmatically: dispatch mousedown + a couple of
 * mousemoves + mouseup over the overlay at the target extent's corners.
 * d3-brush listens for these on the overlay and updates its internal
 * state + fires 'brush'/'end' events, which downstream consumers
 * (Mosaic's Selection, etc.) react to as if the user dragged.
 */
export function applyBrush(node: Element, snap: BrushSnapshot): void {
  const overlay = node.querySelector('rect.overlay');
  if (!overlay) return;
  const rect = overlay.getBoundingClientRect();

  if (snap.sel === null) {
    // A single click outside the existing selection inside the overlay
    // clears the brush in d3.
    const x = rect.left + 1;
    const y = rect.top + 1;
    dispatchMouse(overlay, 'mousedown', x, y);
    dispatchMouse(overlay, 'mouseup', x, y);
    return;
  }

  const [sx, sy, sw, sh] = snap.sel;
  // Translate overlay-local coords to viewport coords. If the overlay
  // is the same size locally, identity. Otherwise scale.
  const localW = rect.width || snap.ow || 1;
  const localH = rect.height || snap.oh || 1;
  const scaleX = snap.ow > 0 ? localW / snap.ow : 1;
  const scaleY = snap.oh > 0 ? localH / snap.oh : 1;

  const x1 = rect.left + sx * scaleX;
  const y1 = rect.top + sy * scaleY;
  const x2 = rect.left + (sx + sw) * scaleX;
  const y2 = rect.top + (sy + sh) * scaleY;

  dispatchMouse(overlay, 'mousedown', x1, y1);
  dispatchMouse(overlay, 'mousemove', (x1 + x2) / 2, (y1 + y2) / 2);
  dispatchMouse(overlay, 'mousemove', x2, y2);
  dispatchMouse(overlay, 'mouseup', x2, y2);
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

interface InstalledBrush {
  cleanup: () => void;
}

export const d3BrushAdapter: SiteAdapter = {
  name: 'd3-brush',
  matches: (url) => {
    // Skip our own demos - they already sync the brush through
    // polychrome.share directly. Adapter would double-mirror it.
    if (url.host === 'karthikbadam.github.io' && url.pathname.startsWith('/polychrome')) return false;
    if (url.hostname === 'localhost' && ['5180', '5181', '5182', '5183', '5184'].includes(url.port)) return false;
    // Match the host list the manifest already covers.
    return true;
  },
  install: (ctx) => {
    const installed = new Map<number, InstalledBrush>();
    let applyingRemote = false;

    function ensureForIndex(node: SVGGElement, index: number): void {
      if (installed.has(index)) return;
      const key = `brush.${index}`;
      const handle = ctx.api.share<BrushSnapshot | null>(key);
      let lastSent: string | undefined;

      const onSelectionMutation = (): void => {
        if (applyingRemote) return;
        const snap = readBrush(node);
        if (!snap) return;
        const ser = JSON.stringify(snap);
        if (ser === lastSent) return;
        lastSent = ser;
        handle.set(snap);
      };
      const obs = new MutationObserver(onSelectionMutation);
      obs.observe(node, {
        attributes: true,
        subtree: true,
        attributeFilter: ['x', 'y', 'width', 'height', 'style', 'display'],
      });

      const unsub = handle.subscribe((snap) => {
        if (!snap) return;
        const ser = JSON.stringify(snap);
        if (ser === lastSent) return;
        lastSent = ser;
        applyingRemote = true;
        try { applyBrush(node, snap); }
        catch (err) { ctx.warn('applyBrush failed for', key, err); }
        // Defer the flag flip past the next microtask. d3-brush's
        // synthetic-event handlers run synchronously and mutate the
        // .selection rect, but MutationObserver delivers its callback
        // as a microtask AFTER applyBrush returns. If we cleared the
        // flag in `finally`, the observer would see applyingRemote=false,
        // treat our own replay as a fresh local drag, and rebroadcast.
        Promise.resolve().then(() => { applyingRemote = false; });
      });

      installed.set(index, { cleanup: () => { obs.disconnect(); unsub(); } });
      ctx.log(`hooked ${key}`);
    }

    function refresh(): void {
      const groups = findBrushGroups();
      groups.forEach((node, i) => ensureForIndex(node, i));
      // Tear down brushes that no longer exist in the DOM.
      for (const i of installed.keys()) {
        if (i >= groups.length) {
          installed.get(i)!.cleanup();
          installed.delete(i);
        }
      }
    }

    refresh();
    // Mosaic + vgplot render plots asynchronously after data loads; watch
    // for new brush groups appearing.
    const domObserver = new MutationObserver(() => refresh());
    domObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      domObserver.disconnect();
      for (const b of installed.values()) b.cleanup();
      installed.clear();
    };
  },
};
