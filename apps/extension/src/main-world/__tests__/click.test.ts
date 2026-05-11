// @vitest-environment jsdom

import type { PolyApi } from '@polychrome/kiosk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installClickSync, CLICK_KEY, type ClickSnapshot } from '../click.js';

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
// jsdom doesn't lay out elements, so elementFromPoint returns null by
// default. Stub it to return a known element.
// ---------------------------------------------------------------------------

let target: HTMLDivElement;
let targetEvents: string[];

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  document.body.innerHTML = '';
  target = document.createElement('div');
  document.body.appendChild(target);
  targetEvents = [];
  for (const t of ['mousedown', 'mouseup', 'click']) {
    target.addEventListener(t, (e) => {
      const me = e as MouseEvent;
      targetEvents.push(`${t}:${Math.round(me.clientX)},${Math.round(me.clientY)}`);
    });
  }
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => target,
  });
});

afterEach(() => {
  document.body.replaceChildren();
});

// In jsdom, MouseEvent.isTrusted is non-configurable on instances and
// always false. installClickSync's `isUserEvent` option lets us inject
// our own predicate; the convention here is "events tagged with
// __pcTrustedTest = true are user input".
const isUserEventForTest = (ev: MouseEvent): boolean =>
  (ev as MouseEvent & { __pcTrustedTest?: boolean }).__pcTrustedTest === true;

function fireUserClick(x: number, y: number, button = 0): void {
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button, clientX: x, clientY: y });
  (ev as MouseEvent & { __pcTrustedTest?: boolean }).__pcTrustedTest = true;
  document.dispatchEvent(ev);
}

describe('installClickSync', () => {
  it('broadcasts the click coords + viewport dimensions', () => {
    const f = fakeApi();
    const h = installClickSync({
      api: f.api,
      isUserEvent: isUserEventForTest,
      now: () => 1000,
      nonce: () => 'n1',
    });

    fireUserClick(123, 456);

    expect(f.setSpy).toHaveBeenCalledTimes(1);
    const [key, snap] = f.setSpy.mock.calls[0] as [string, ClickSnapshot];
    expect(key).toBe(CLICK_KEY);
    expect(snap.x).toBe(123);
    expect(snap.y).toBe(456);
    expect(snap.vw).toBe(1000);
    expect(snap.vh).toBe(800);
    expect(snap.button).toBe(0);
    expect(snap.t).toBe(1000);
    expect(snap.nonce).toBe('n1');

    h.destroy();
  });

  it('ignores untagged (non-user) clicks - the production isTrusted gate', () => {
    const f = fakeApi();
    const h = installClickSync({ api: f.api, isUserEvent: isUserEventForTest });

    // Default jsdom-issued events don't carry the test trust tag.
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, clientX: 10, clientY: 20 }));

    expect(f.setSpy).not.toHaveBeenCalled();
    h.destroy();
  });

  it('ignores non-primary buttons', () => {
    const f = fakeApi();
    const h = installClickSync({ api: f.api, isUserEvent: isUserEventForTest });

    fireUserClick(10, 20, 2);

    expect(f.setSpy).not.toHaveBeenCalled();
    h.destroy();
  });

  it('applies a remote snapshot via mousedown/mouseup/click on the target', () => {
    const f = fakeApi();
    const h = installClickSync({ api: f.api, isUserEvent: isUserEventForTest });

    f.inject(CLICK_KEY, {
      x: 200, y: 300, vw: 1000, vh: 800, button: 0, t: 0, nonce: 'r1',
    } satisfies ClickSnapshot);

    expect(targetEvents).toEqual([
      'mousedown:200,300',
      'mouseup:200,300',
      'click:200,300',
    ]);
    h.destroy();
  });

  it('rescales remote coords by sender vs local viewport', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 });
    const f = fakeApi();
    const h = installClickSync({ api: f.api, isUserEvent: isUserEventForTest });

    f.inject(CLICK_KEY, {
      x: 400, y: 600, vw: 1000, vh: 800, button: 0, t: 0, nonce: 'r1',
    } satisfies ClickSnapshot);

    expect(targetEvents).toEqual([
      'mousedown:200,300',  // 400 * (500/1000) = 200; 600 * (400/800) = 300
      'mouseup:200,300',
      'click:200,300',
    ]);
    h.destroy();
  });

  it('does not replay the initial snapshot on subscribe (avoids stale clicks on reconnect)', () => {
    const f = fakeApi();
    // Pre-load a stale click into the share storage BEFORE we install.
    f.inject(CLICK_KEY, {
      x: 50, y: 50, vw: 1000, vh: 800, button: 0, t: 0, nonce: 'stale',
    } satisfies ClickSnapshot);
    targetEvents = []; // reset (no subscribers existed yet)

    const h = installClickSync({ api: f.api, isUserEvent: isUserEventForTest });
    expect(targetEvents).toEqual([]); // initial value was skipped

    // A subsequent inject IS replayed.
    f.inject(CLICK_KEY, {
      x: 100, y: 100, vw: 1000, vh: 800, button: 0, t: 1, nonce: 'fresh',
    } satisfies ClickSnapshot);
    expect(targetEvents).toEqual([
      'mousedown:100,100',
      'mouseup:100,100',
      'click:100,100',
    ]);
    h.destroy();
  });

  it('replayed dispatches are not re-broadcast (synthesized events untagged)', () => {
    const f = fakeApi();
    const h = installClickSync({ api: f.api, isUserEvent: isUserEventForTest });

    f.inject(CLICK_KEY, {
      x: 10, y: 10, vw: 1000, vh: 800, button: 0, t: 0, nonce: 'r1',
    } satisfies ClickSnapshot);

    expect(f.setSpy).not.toHaveBeenCalled();
    h.destroy();
  });

  it('destroy() removes the click listener', () => {
    const f = fakeApi();
    const h = installClickSync({ api: f.api, isUserEvent: isUserEventForTest });
    h.destroy();

    fireUserClick(10, 20);
    expect(f.setSpy).not.toHaveBeenCalled();
  });
});
