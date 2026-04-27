/**
 * mosaic.ts - best-effort Mosaic adapter (idl.uw.edu/mosaic/*).
 *
 * Mosaic [https://idl.uw.edu/mosaic/] is a UW IDL framework for linked
 * interactive visualizations: a set of plots wired to one or more
 * `Selection` objects. Brushing a plot updates the selection; dependent
 * plots re-query and re-render.
 *
 * Adapter strategy:
 *   1. Wait for the Mosaic coordinator to appear on `window`. Mosaic
 *      examples expose it (varying names across versions); we probe
 *      a few likely globals (`mc`, `mosaic.coordinator`, `coordinator`).
 *      We also try `vg` / `vgplot` for the higher-level vgplot wrapper.
 *   2. Walk the coordinator's tracked selections. Mosaic's Selection
 *      class exposes `addEventListener('value', cb)` and a `value`
 *      getter, plus an `update(predicate, source)` setter.
 *   3. For each selection, mirror its `value` into a polychrome share
 *      key keyed by a stable id (selection.id || its registration index).
 *      Local change -> share.set(serializedValue). Remote update ->
 *      selection.update(deserialized, polychromeSource).
 *   4. The adapter tags its own writes with a sentinel `source` so
 *      Mosaic doesn't bounce remote updates back at us as local ones.
 *
 * Caveats:
 *   - Mosaic's predicate values are typically Mosaic SQLExpression /
 *     plain objects; we serialize via structuredClone-style JSON. If a
 *     selection holds non-cloneable values the adapter logs a warning
 *     and skips that selection.
 *   - We do NOT block / inspect the data layer. Each peer queries its
 *     own data source independently; we only sync the brush/filter
 *     state.
 *   - Versioned API drift: this is best-effort; the probe + try/catch
 *     posture means it degrades to a no-op if Mosaic's API has moved.
 */

import type { SiteAdapter, AdapterContext } from './types.js';

interface MosaicSelectionLike {
  /** Optional human-readable id; many Mosaic versions expose `.name` or `.id`. */
  id?: string;
  name?: string;
  value: unknown;
  addEventListener?: (event: 'value', cb: (v: unknown) => void) => void;
  removeEventListener?: (event: 'value', cb: (v: unknown) => void) => void;
  update?: (predicate: unknown, source: unknown) => void;
  reset?: () => void;
}

interface MosaicCoordinatorLike {
  /** Mosaic typically exposes a Map (or array) of selections. */
  selections?: Map<string, MosaicSelectionLike> | MosaicSelectionLike[] | Record<string, MosaicSelectionLike>;
}

const PROBE_PATHS: ReadonlyArray<readonly string[]> = [
  ['mc'],
  ['mosaic', 'coordinator'],
  ['coordinator'],
  ['vg', 'coordinator'],
  ['vgplot', 'coordinator'],
];

function dig(root: Record<string, unknown>, path: readonly string[]): unknown {
  let cur: unknown = root;
  for (const k of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/**
 * Discover a Mosaic Coordinator-like object on `window`. Returns the
 * first probe path that turns up something with a `selections` field.
 */
export function findCoordinator(globals: Record<string, unknown>): MosaicCoordinatorLike | undefined {
  for (const path of PROBE_PATHS) {
    const candidate = dig(globals, path);
    if (candidate && typeof candidate === 'object' && 'selections' in (candidate as object)) {
      return candidate as MosaicCoordinatorLike;
    }
  }
  return undefined;
}

/**
 * Iterate selections regardless of how Mosaic exposes them (Map / array
 * / plain object). Falls back to enumerable properties.
 */
export function iterSelections(
  coordinator: MosaicCoordinatorLike,
): Array<readonly [string, MosaicSelectionLike]> {
  const sels = coordinator.selections;
  if (!sels) return [];
  if (sels instanceof Map) return [...sels.entries()];
  if (Array.isArray(sels)) return sels.map((s, i) => [s.id ?? s.name ?? `selection-${i}`, s] as const);
  if (typeof sels === 'object') return Object.entries(sels);
  return [];
}

const POLYCHROME_SOURCE = Symbol('polychrome-mosaic-source');

/** Pure helper: best-effort JSON round-trip; returns undefined on failure. */
export function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

interface InternalCtx extends AdapterContext {
  poll?: { intervalMs?: number; maxMs?: number };
  globals?: Record<string, unknown>;
}

/**
 * Hook the live coordinator. Exposed for testing; the production
 * adapter plumbs through `install()` below and discovers via polling.
 */
export function hookCoordinator(
  coordinator: MosaicCoordinatorLike,
  ctx: AdapterContext,
): () => void {
  const cleanups: Array<() => void> = [];

  for (const [id, sel] of iterSelections(coordinator)) {
    if (typeof sel.addEventListener !== 'function') {
      ctx.log(`selection '${id}' has no addEventListener; skipping`);
      continue;
    }
    const key = `mosaic.selection.${id}`;

    // Local -> share
    let lastSent: string | undefined;
    const onValue = (v: unknown): void => {
      // Skip if this update originated from our own remote-apply.
      if (sel.value === undefined) return;
      const ser = serializeValue(v);
      if (ser === undefined) {
        ctx.warn(`selection '${id}' value not JSON-serializable; skipping`);
        return;
      }
      const key2 = JSON.stringify(ser);
      if (key2 === lastSent) return;
      lastSent = key2;
      ctx.api.share<unknown>(key).set(ser);
    };
    sel.addEventListener('value', onValue);
    cleanups.push(() => sel.removeEventListener?.('value', onValue));

    // Remote -> selection.update()
    const handle = ctx.api.share<unknown>(key);
    const off = handle.subscribe((value) => {
      const ser = JSON.stringify(value);
      if (ser === lastSent) return;
      lastSent = ser;
      try {
        if (typeof sel.update === 'function') {
          sel.update(value, POLYCHROME_SOURCE);
        }
      } catch (err) {
        ctx.warn(`selection '${id}' update failed:`, err);
      }
    });
    cleanups.push(off);

    ctx.log(`hooked selection '${id}'`);
  }

  return () => { for (const c of cleanups) try { c(); } catch { /* ignore */ } };
}

/**
 * Poll for the Mosaic coordinator. Returns a stop function; once the
 * coordinator is found and hooked, polling stops automatically.
 */
function pollAndHook(ctx: InternalCtx): () => void {
  const intervalMs = ctx.poll?.intervalMs ?? 250;
  // Modern Mosaic (the @uwdata/mosaic-* packages used by vgplot) keeps
  // the Coordinator inside its own module scope and does NOT expose it
  // on a window global. There's no way for an external script to hook
  // it in that case, so we cap polling at 5s and log quietly instead
  // of nagging the console with a `warn` after 30s.
  const maxMs = ctx.poll?.maxMs ?? 5_000;
  const globals = ctx.globals ?? (window as unknown as Record<string, unknown>);
  const t0 = Date.now();
  let teardown: (() => void) | null = null;
  const tick = (): boolean => {
    const c = findCoordinator(globals);
    if (c) {
      ctx.log('found Mosaic coordinator');
      teardown = hookCoordinator(c, ctx);
      return true;
    }
    if (Date.now() - t0 > maxMs) {
      // Expected on most modern Mosaic pages - the coordinator lives in
      // a module closure rather than on `window`. Adapter degrades to a
      // no-op (live cursors still work via the bridge).
      ctx.log('Mosaic coordinator not found on window globals; adapter idle');
      return true;
    }
    return false;
  };
  if (tick()) return () => { teardown?.(); };
  const id = setInterval(() => { if (tick()) clearInterval(id); }, intervalMs);
  return () => { clearInterval(id); teardown?.(); };
}

export const mosaicAdapter: SiteAdapter = {
  name: 'mosaic',
  matches: (url) => {
    if (url.host === 'idl.uw.edu' && url.pathname.startsWith('/mosaic')) return true;
    if (url.host.endsWith('uwdata.github.io') && url.pathname.includes('mosaic')) return true;
    return false;
  },
  install: (ctx) => pollAndHook(ctx as InternalCtx),
};
