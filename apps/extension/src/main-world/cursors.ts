/**
 * cursors.ts - per-peer live cursor presence on a shared page.
 *
 * Local pointer movement is throttled (default 33ms = ~30Hz) and
 * published to Yjs awareness as `{ cursor: { x, y, t } }` in
 * page-pixel coords. Remote awareness states with `cursor` are
 * rendered as a colored arrow + name label at the matching position.
 *
 * The factory is decoupled from y-webrtc so the throttling and
 * render logic can be unit-tested with a fake "awareness" surface.
 */

/**
 * Minimal subset of y-protocols/awareness we use - typed locally so we
 * don't pull the whole y-protocols package into our types.
 */
export interface Awareness {
  on(event: 'change', cb: () => void): void;
  off(event: 'change', cb: () => void): void;
  getStates(): Map<number, unknown>;
  setLocalStateField(field: string, value: unknown): void;
}

export interface CursorPoint { x: number; y: number; t: number }

export interface CursorIdentity { actorId: string; name: string; color: string }

export interface CursorOptions {
  awareness: Awareness;
  /** This peer's identity. Used to filter out self when rendering. */
  self: CursorIdentity;
  /** Document the local pointer events come from. Defaults to `document`. */
  source?: Document;
  /** Container under which to render remote cursors. Defaults to `document.body`. */
  host?: HTMLElement;
  /** Throttle interval in ms. */
  throttleMs?: number;
  /** Time since last move that hides a remote cursor. */
  staleMs?: number;
  /** Injected for tests. */
  now?: () => number;
}

export interface CursorsHandle {
  /** Re-read awareness and re-paint visible cursors. Auto-runs on awareness `change`. */
  render(): void;
  destroy(): void;
}

const NS = 'http://www.w3.org/1999/xhtml';

/** Time-bucketed throttle: emits `fn(arg)` at most once per `intervalMs`. */
export function makeThrottle<T>(
  fn: (arg: T) => void,
  intervalMs: number,
  now: () => number = Date.now,
): { call: (arg: T) => void; flush: () => void } {
  let lastEmit: number | null = null;
  let pending: { arg: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function emit(arg: T): void { lastEmit = now(); fn(arg); }

  return {
    call(arg) {
      const t = now();
      // First call ever: lead-edge emit.
      if (lastEmit === null || t - lastEmit >= intervalMs) {
        if (timer) { clearTimeout(timer); timer = null; pending = null; }
        emit(arg);
        return;
      }
      // Trailing: schedule the latest arg to fire when the window opens.
      pending = { arg };
      if (!timer) {
        const dt = t - lastEmit;
        timer = setTimeout(() => {
          timer = null;
          if (pending) { const p = pending; pending = null; emit(p.arg); }
        }, intervalMs - dt);
      }
    },
    flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (pending) { const p = pending; pending = null; emit(p.arg); }
    },
  };
}

export function installCursors(opts: CursorOptions): CursorsHandle {
  const source = opts.source ?? document;
  const host = opts.host ?? source.body;
  const throttleMs = opts.throttleMs ?? 33;
  const staleMs = opts.staleMs ?? 5_000;
  const now = opts.now ?? Date.now;

  const layer = source.createElementNS(NS, 'div') as HTMLDivElement;
  layer.className = 'pc-cursor-layer';
  layer.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:hidden;';
  host.appendChild(layer);

  // -- Local broadcast -----------------------------------------------------

  const send = makeThrottle<CursorPoint>((p) => {
    opts.awareness.setLocalStateField('cursor', p);
  }, throttleMs, now);

  function onMove(ev: PointerEvent | MouseEvent): void {
    send.call({ x: ev.clientX, y: ev.clientY, t: now() });
  }
  function onLeave(): void {
    opts.awareness.setLocalStateField('cursor', null);
  }
  source.addEventListener('pointermove', onMove);
  source.addEventListener('pointerleave', onLeave);
  source.addEventListener('mouseleave', onLeave);

  // -- Remote render --------------------------------------------------------

  const dots = new Map<string, HTMLDivElement>();

  function ensureDot(actor: string, color: string): HTMLDivElement {
    let dot = dots.get(actor);
    if (dot) return dot;
    dot = source.createElementNS(NS, 'div') as HTMLDivElement;
    dot.className = 'pc-cursor';
    dot.style.cssText = [
      'position:absolute', 'top:0', 'left:0',
      'transform:translate(-2px,-2px)',
      'pointer-events:none',
      'transition:transform 80ms linear',
    ].join(';');
    dot.innerHTML = `
      <svg width="20" height="22" viewBox="0 0 20 22" xmlns="http://www.w3.org/2000/svg" style="display:block">
        <path d="M2 2 L2 18 L7 14 L10 20 L13 19 L10 13 L17 13 Z"
          fill="${escapeAttr(color)}" stroke="rgba(0,0,0,0.4)" stroke-width="1" stroke-linejoin="round"/>
      </svg>
      <span class="pc-cursor-label" style="
        display:inline-block;margin-left:4px;padding:2px 6px;border-radius:4px;
        background:${escapeAttr(color)};color:#0e0f12;font:600 11px/1 -apple-system,system-ui,sans-serif;
        vertical-align:top;
      "></span>
    `;
    layer.appendChild(dot);
    dots.set(actor, dot);
    return dot;
  }

  function paint(): void {
    const states = opts.awareness.getStates();
    const seen = new Set<string>();
    const t = now();

    for (const [, state] of states) {
      const s = state as { user?: CursorIdentity; cursor?: CursorPoint | null } | undefined;
      const u = s?.user;
      const c = s?.cursor;
      if (!u || !c) continue;
      if (u.actorId === opts.self.actorId) continue;
      if (t - c.t > staleMs) continue;
      seen.add(u.actorId);

      const dot = ensureDot(u.actorId, u.color);
      dot.style.transform = `translate(${c.x - 2}px, ${c.y - 2}px)`;
      const label = dot.querySelector<HTMLSpanElement>('.pc-cursor-label');
      if (label) label.textContent = u.name;
    }

    // Drop dots for peers we no longer see.
    for (const [actor, dot] of dots) {
      if (!seen.has(actor)) {
        dot.remove();
        dots.delete(actor);
      }
    }
  }

  const onAwarenessChange = (): void => paint();
  opts.awareness.on('change', onAwarenessChange);

  // Periodic repaint culls stale entries even without explicit awareness change.
  const sweepTimer = setInterval(paint, 1000);

  paint();

  return {
    render: paint,
    destroy() {
      send.flush();
      try { opts.awareness.setLocalStateField('cursor', null); } catch { /* ignore */ }
      opts.awareness.off('change', onAwarenessChange);
      clearInterval(sweepTimer);
      source.removeEventListener('pointermove', onMove);
      source.removeEventListener('pointerleave', onLeave);
      source.removeEventListener('mouseleave', onLeave);
      layer.remove();
      dots.clear();
    },
  };
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c));
}
