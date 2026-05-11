// @vitest-environment jsdom

import type { PolyApi } from '@polychrome/kiosk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installScrollSync, SCROLL_KEY, type ScrollSnapshot } from '../scroll.js';

// ---------------------------------------------------------------------------
// Fake polychrome api - just the `share` surface, with kiosk's SELF-filter
// semantics (local set() does NOT call our own subscribers).
// ---------------------------------------------------------------------------

interface FakeApi {
  api: PolyApi;
  setSpy: ReturnType<typeof vi.fn>;
  inject(key: string, value: unknown): void;
}

function fakeApi(): FakeApi {
  const store = new Map<string, unknown>();
  const subs = new Map<string, Array<(v: unknown) => void>>();
  const setSpy = vi.fn();
  const fire = (key: string, v: unknown): void => {
    for (const cb of subs.get(key) ?? []) cb(v);
  };
  const api = {
    share<T>(key: string) {
      return {
        get: (): T => store.get(key) as T,
        set: (v: T): void => { setSpy(key, v); store.set(key, v); /* mimic SELF filter */ },
        subscribe(cb: (v: T) => void): () => void {
          let arr = subs.get(key);
          if (!arr) { arr = []; subs.set(key, arr); }
          arr.push(cb as (v: unknown) => void);
          if (store.has(key)) cb(store.get(key) as T);
          return () => {
            const cur = subs.get(key) ?? [];
            subs.set(key, cur.filter((s) => s !== (cb as unknown)));
          };
        },
      };
    },
    list: () => ({ get: () => [], insert: () => { /* */ }, delete: () => { /* */ }, subscribe: () => () => { /* */ } }),
    checkpoint: () => { /* */ },
    self: { actorId: 'A', name: 'alice', color: '#7c5cff' },
    history: { all: () => [], subscribe: () => () => { /* */ }, undo: () => false, undoLastBy: () => null },
  } as unknown as PolyApi;
  return { api, setSpy, inject: (k, v) => { store.set(k, v); fire(k, v); } };
}

// ---------------------------------------------------------------------------
// jsdom doesn't actually scroll, so stub the bits we touch.
// ---------------------------------------------------------------------------

let scrollXVal = 0;
let scrollYVal = 0;
let scrollWidthVal = 1000;
let scrollHeightVal = 2000;
let scrollToSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollXVal = 0;
  scrollYVal = 0;
  scrollWidthVal = 1000;
  scrollHeightVal = 2000;
  Object.defineProperty(window, 'scrollX', { configurable: true, get: () => scrollXVal });
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollYVal });
  Object.defineProperty(document.documentElement, 'scrollWidth', { configurable: true, get: () => scrollWidthVal });
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => scrollHeightVal });
  scrollToSpy = vi.fn();
  window.scrollTo = scrollToSpy as unknown as typeof window.scrollTo;
});

afterEach(() => {
  vi.useRealTimers();
});

function fireScroll(): void {
  window.dispatchEvent(new Event('scroll'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('installScrollSync', () => {
  it('broadcasts the current scroll position on a local scroll event', () => {
    const f = fakeApi();
    const h = installScrollSync({ api: f.api, throttleMs: 100, now: () => 0 });

    scrollXVal = 30;
    scrollYVal = 120;
    fireScroll();

    expect(f.setSpy).toHaveBeenCalledTimes(1);
    const [key, snap] = f.setSpy.mock.calls[0] as [string, ScrollSnapshot];
    expect(key).toBe(SCROLL_KEY);
    expect(snap.x).toBe(30);
    expect(snap.y).toBe(120);
    expect(snap.docW).toBe(1000);
    expect(snap.docH).toBe(2000);

    h.destroy();
  });

  it('throttles rapid scroll events', () => {
    vi.useFakeTimers();
    let now = 0;
    const f = fakeApi();
    const h = installScrollSync({ api: f.api, throttleMs: 50, now: () => now });

    // 5 rapid scrolls; only the first should fire immediately.
    for (let i = 0; i < 5; i++) {
      scrollYVal = i * 10;
      fireScroll();
    }
    expect(f.setSpy).toHaveBeenCalledTimes(1);

    // Advance past the throttle window: the latest position is emitted.
    now = 60;
    vi.advanceTimersByTime(60);
    expect(f.setSpy).toHaveBeenCalledTimes(2);
    const last = f.setSpy.mock.calls[1]![1] as ScrollSnapshot;
    expect(last.y).toBe(40); // i=4 -> 40

    h.destroy();
  });

  it('applies a remote snapshot via window.scrollTo', () => {
    const f = fakeApi();
    const h = installScrollSync({ api: f.api });

    f.inject(SCROLL_KEY, { x: 100, y: 250, docW: 1000, docH: 2000, t: 0 } satisfies ScrollSnapshot);

    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    const arg = scrollToSpy.mock.calls[0]![0] as { left: number; top: number };
    expect(arg.left).toBe(100);
    expect(arg.top).toBe(250);

    h.destroy();
  });

  it('rescales remote snapshots by sender vs local document dimensions', () => {
    const f = fakeApi();
    scrollWidthVal = 500;   // local doc is half as wide
    scrollHeightVal = 4000; // local doc is twice as tall
    const h = installScrollSync({ api: f.api });

    f.inject(SCROLL_KEY, { x: 400, y: 500, docW: 1000, docH: 2000, t: 0 } satisfies ScrollSnapshot);

    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    const arg = scrollToSpy.mock.calls[0]![0] as { left: number; top: number };
    expect(arg.left).toBe(200);  // 400 * (500/1000)
    expect(arg.top).toBe(1000);  // 500 * (4000/2000)

    h.destroy();
  });

  it('suppresses local broadcasts immediately after a remote apply (echo guard)', () => {
    let now = 0;
    const f = fakeApi();
    const h = installScrollSync({ api: f.api, throttleMs: 10, suppressMs: 200, now: () => now });

    // Remote arrival - we scrollTo, browser would then dispatch a synthetic
    // scroll event. We simulate that here.
    f.inject(SCROLL_KEY, { x: 50, y: 80, docW: 1000, docH: 2000, t: 0 } satisfies ScrollSnapshot);
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    expect(f.setSpy).not.toHaveBeenCalled();

    now = 10;
    scrollXVal = 50;
    scrollYVal = 80;
    fireScroll(); // synthetic from the programmatic scrollTo - must NOT broadcast
    expect(f.setSpy).not.toHaveBeenCalled();

    // After the suppression window, a fresh user scroll DOES broadcast.
    now = 300;
    scrollYVal = 150;
    fireScroll();
    expect(f.setSpy).toHaveBeenCalledTimes(1);

    h.destroy();
  });

  it('destroy() removes the scroll listener and stops broadcasting', () => {
    const f = fakeApi();
    const h = installScrollSync({ api: f.api, now: () => 0 });
    h.destroy();

    scrollYVal = 50;
    fireScroll();
    expect(f.setSpy).not.toHaveBeenCalled();
  });
});
