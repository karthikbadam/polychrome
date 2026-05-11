// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installCursors, makeThrottle, type CursorPoint } from '../cursors.js';

// ---------------------------------------------------------------------------
// makeThrottle
// ---------------------------------------------------------------------------

describe('makeThrottle', () => {
  it('emits the first call immediately', () => {
    const fn = vi.fn();
    const t = makeThrottle(fn, 100, () => 0);
    t.call(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it('drops mid-window calls but keeps the latest as a trailing emit', () => {
    vi.useFakeTimers();
    let now = 0;
    const fn = vi.fn();
    const t = makeThrottle(fn, 100, () => now);

    t.call('a'); // immediate (t=0)
    now = 10;
    t.call('b'); // queued
    now = 50;
    t.call('c'); // overwrites the queued 'b'
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith('a');

    // Advance to when the trailing fire is due.
    now = 100;
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('c');

    vi.useRealTimers();
  });

  it('flush() emits any pending value immediately', () => {
    vi.useFakeTimers();
    let now = 0;
    const fn = vi.fn();
    const t = makeThrottle(fn, 100, () => now);

    t.call('a'); // emit
    now = 20;
    t.call('b'); // queued
    expect(fn).toHaveBeenCalledTimes(1);
    t.flush();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('b');
    vi.useRealTimers();
  });

  it('typed values pass through unchanged', () => {
    const fn = vi.fn<(p: CursorPoint) => void>();
    const t = makeThrottle(fn, 100, () => 0);
    t.call({ x: 1, y: 2, t: 3 });
    expect(fn).toHaveBeenCalledWith({ x: 1, y: 2, t: 3 });
  });
});

// ---------------------------------------------------------------------------
// installCursors - rendering remote awareness states
// ---------------------------------------------------------------------------

interface FakeAwareness {
  states: Map<number, unknown>;
  listeners: Set<() => void>;
  clientID: number;
  on(event: string, cb: () => void): void;
  off(event: string, cb: () => void): void;
  getStates(): Map<number, unknown>;
  setLocalStateField(field: string, value: unknown): void;
  emit(): void;
}

function fakeAwareness(clientID = 1): FakeAwareness {
  const states = new Map<number, unknown>();
  const listeners = new Set<() => void>();
  states.set(clientID, {}); // self
  return {
    states,
    listeners,
    clientID,
    on(event, cb) { if (event === 'change') listeners.add(cb); },
    off(event, cb) { if (event === 'change') listeners.delete(cb); },
    getStates() { return states; },
    setLocalStateField(field, value) {
      const cur = (states.get(clientID) as Record<string, unknown> | undefined) ?? {};
      states.set(clientID, { ...cur, [field]: value });
      this.emit();
    },
    emit() { for (const cb of listeners) cb(); },
  };
}

describe('installCursors', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('renders a cursor for a remote peer with an active cursor field', () => {
    const aw = fakeAwareness();
    aw.states.set(2, {
      user: { actorId: 'B', name: 'bob', color: '#ff5c7c' },
      cursor: { x: 100, y: 50, t: Date.now() },
    });

    const h = installCursors({
      awareness: aw as unknown as Parameters<typeof installCursors>[0]['awareness'],
      self: { actorId: 'A', name: 'alice', color: '#7c5cff' },
      host,
    });

    const dots = host.querySelectorAll('.pc-cursor');
    expect(dots).toHaveLength(1);
    const dot = dots[0] as HTMLDivElement;
    expect(dot.style.transform).toContain('98px');
    expect(dot.style.transform).toContain('48px');
    expect(dot.querySelector('.pc-cursor-label')!.textContent).toBe('bob');

    h.destroy();
  });

  it('does not render a cursor for self (filtered by Yjs clientID)', () => {
    const aw = fakeAwareness(1); // self is clientID 1
    aw.states.set(1, {
      user: { actorId: 'A', name: 'alice', color: '#7c5cff' },
      cursor: { x: 10, y: 20, t: Date.now() },
    });

    const h = installCursors({
      awareness: aw as unknown as Parameters<typeof installCursors>[0]['awareness'],
      self: { actorId: 'A', name: 'alice', color: '#7c5cff' },
      host,
    });

    expect(host.querySelectorAll('.pc-cursor')).toHaveLength(0);
    h.destroy();
  });

  it('renders two peers that share an actorId but have distinct clientIDs', () => {
    // The extension issues one identity per browser, so two tabs of the
    // same browser have the SAME actorId but different Yjs clientIDs.
    // Both should appear as cursors on a third peer.
    const aw = fakeAwareness(1);
    aw.states.set(2, {
      user: { actorId: 'A', name: 'alice', color: '#7c5cff' },
      cursor: { x: 10, y: 20, t: Date.now() },
    });
    aw.states.set(3, {
      user: { actorId: 'A', name: 'alice', color: '#7c5cff' },
      cursor: { x: 100, y: 200, t: Date.now() },
    });
    const h = installCursors({
      awareness: aw as unknown as Parameters<typeof installCursors>[0]['awareness'],
      self: { actorId: 'B', name: 'bob', color: '#5cffb1' },
      host,
    });
    expect(host.querySelectorAll('.pc-cursor')).toHaveLength(2);
    h.destroy();
  });

  it('renders a peer regardless of cursor.t age (no clock-skew gate)', () => {
    // Earlier versions filtered remote cursors by comparing the
    // sender's Date.now() in cursor.t against the receiver's now().
    // That tripped on cross-device clock skew and would silently drop
    // cursors. Awareness culls truly stale peers on its own; this
    // test pins the new behavior.
    const aw = fakeAwareness();
    aw.states.set(2, {
      user: { actorId: 'B', name: 'bob', color: '#ff5c7c' },
      cursor: { x: 1, y: 2, t: 0 }, // looks 'old' on a now-10s clock
    });

    const h = installCursors({
      awareness: aw as unknown as Parameters<typeof installCursors>[0]['awareness'],
      self: { actorId: 'A', name: 'alice', color: '#7c5cff' },
      host,
      now: () => 10_000,
    });

    expect(host.querySelectorAll('.pc-cursor')).toHaveLength(1);
    h.destroy();
  });

  it('removes a cursor dot when the peer drops out of awareness', () => {
    const aw = fakeAwareness();
    aw.states.set(2, {
      user: { actorId: 'B', name: 'bob', color: '#ff5c7c' },
      cursor: { x: 10, y: 20, t: Date.now() },
    });
    const h = installCursors({
      awareness: aw as unknown as Parameters<typeof installCursors>[0]['awareness'],
      self: { actorId: 'A', name: 'alice', color: '#7c5cff' },
      host,
    });
    expect(host.querySelectorAll('.pc-cursor')).toHaveLength(1);

    aw.states.delete(2);
    aw.emit();
    expect(host.querySelectorAll('.pc-cursor')).toHaveLength(0);

    h.destroy();
  });

  it('reuses the same DOM node for a peer across updates', () => {
    const aw = fakeAwareness();
    aw.states.set(2, {
      user: { actorId: 'B', name: 'bob', color: '#ff5c7c' },
      cursor: { x: 10, y: 20, t: Date.now() },
    });
    const h = installCursors({
      awareness: aw as unknown as Parameters<typeof installCursors>[0]['awareness'],
      self: { actorId: 'A', name: 'alice', color: '#7c5cff' },
      host,
    });
    const before = host.querySelector('.pc-cursor');
    aw.states.set(2, {
      user: { actorId: 'B', name: 'bob', color: '#ff5c7c' },
      cursor: { x: 50, y: 60, t: Date.now() },
    });
    aw.emit();
    const after = host.querySelector('.pc-cursor');
    expect(after).toBe(before);
    expect((after as HTMLDivElement).style.transform).toContain('48px');
    expect((after as HTMLDivElement).style.transform).toContain('58px');
    h.destroy();
  });

  it('destroy() tears down the cursor layer', () => {
    const aw = fakeAwareness();
    aw.states.set(2, {
      user: { actorId: 'B', name: 'bob', color: '#ff5c7c' },
      cursor: { x: 10, y: 20, t: Date.now() },
    });
    const h = installCursors({
      awareness: aw as unknown as Parameters<typeof installCursors>[0]['awareness'],
      self: { actorId: 'A', name: 'alice', color: '#7c5cff' },
      host,
    });
    expect(host.querySelector('.pc-cursor-layer')).not.toBeNull();
    h.destroy();
    expect(host.querySelector('.pc-cursor-layer')).toBeNull();
  });

  it('throttles local pointermove broadcasts', () => {
    vi.useFakeTimers();
    let now = 0;
    const aw = fakeAwareness();
    const setSpy = vi.spyOn(aw, 'setLocalStateField');

    const h = installCursors({
      awareness: aw as unknown as Parameters<typeof installCursors>[0]['awareness'],
      self: { actorId: 'A', name: 'alice', color: '#7c5cff' },
      host,
      throttleMs: 50,
      now: () => now,
    });

    // 5 rapid pointermove events; only first should fire immediately.
    for (let i = 0; i < 5; i++) {
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: i * 10, clientY: i * 5 }));
    }
    const cursorCalls = setSpy.mock.calls.filter(c => c[0] === 'cursor');
    expect(cursorCalls).toHaveLength(1);

    // Advance to flush the trailing emit.
    now = 60;
    vi.advanceTimersByTime(60);
    const cursorCalls2 = setSpy.mock.calls.filter(c => c[0] === 'cursor');
    expect(cursorCalls2.length).toBeGreaterThanOrEqual(2);

    h.destroy();
    vi.useRealTimers();
  });
});
