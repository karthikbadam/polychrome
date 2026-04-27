import { describe, expect, it, vi } from 'vitest';

import {
  findCoordinator,
  hookCoordinator,
  iterSelections,
  mosaicAdapter,
  serializeValue,
} from '../mosaic.js';

import type { AdapterContext } from '../types.js';

// ---------------------------------------------------------------------------
// URL matcher
// ---------------------------------------------------------------------------

describe('mosaicAdapter.matches', () => {
  const m = (url: string): boolean => mosaicAdapter.matches(new URL(url));
  it('matches idl.uw.edu/mosaic and sub-paths', () => {
    expect(m('https://idl.uw.edu/mosaic/')).toBe(true);
    expect(m('https://idl.uw.edu/mosaic/examples/foo')).toBe(true);
  });
  it('matches uwdata.github.io paths containing mosaic', () => {
    expect(m('https://uwdata.github.io/mosaic/')).toBe(true);
    expect(m('https://uwdata.github.io/mosaic/examples/x')).toBe(true);
  });
  it('does NOT match unrelated hosts', () => {
    expect(m('https://example.com/mosaic/')).toBe(false);
    expect(m('https://idl.uw.edu/other/')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findCoordinator
// ---------------------------------------------------------------------------

describe('findCoordinator', () => {
  it('returns undefined when nothing matches', () => {
    expect(findCoordinator({})).toBeUndefined();
  });

  it('finds `mc` at the top level', () => {
    const coord = { selections: new Map() };
    expect(findCoordinator({ mc: coord })).toBe(coord);
  });

  it('finds `mosaic.coordinator`', () => {
    const coord = { selections: new Map() };
    expect(findCoordinator({ mosaic: { coordinator: coord } })).toBe(coord);
  });

  it('finds `vg.coordinator`', () => {
    const coord = { selections: [] };
    expect(findCoordinator({ vg: { coordinator: coord } })).toBe(coord);
  });

  it('ignores objects without a `selections` field', () => {
    expect(findCoordinator({ mc: { other: 1 } })).toBeUndefined();
  });

  it('handles non-object intermediates without throwing', () => {
    expect(findCoordinator({ mosaic: 5 as unknown })).toBeUndefined();
    expect(findCoordinator({ mosaic: null })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// iterSelections
// ---------------------------------------------------------------------------

describe('iterSelections', () => {
  it('iterates a Map keyed by string', () => {
    const sel = { value: 1 };
    const out = iterSelections({ selections: new Map([['x', sel]]) });
    expect(out).toEqual([['x', sel]]);
  });

  it('iterates an array using selection.id || .name || synthetic id', () => {
    const a = { id: 'a', value: 1 };
    const b = { name: 'b', value: 2 };
    const c = { value: 3 };
    const out = iterSelections({ selections: [a, b, c] });
    expect(out.map(([k]) => k)).toEqual(['a', 'b', 'selection-2']);
  });

  it('iterates plain object entries', () => {
    const a = { value: 1 };
    const out = iterSelections({ selections: { only: a } });
    expect(out).toEqual([['only', a]]);
  });

  it('returns [] when selections missing', () => {
    expect(iterSelections({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// serializeValue
// ---------------------------------------------------------------------------

describe('serializeValue', () => {
  it('round-trips JSON-friendly values', () => {
    expect(serializeValue({ a: 1, b: [2, 3] })).toEqual({ a: 1, b: [2, 3] });
  });
  it('preserves null / undefined identity', () => {
    expect(serializeValue(null)).toBeNull();
    expect(serializeValue(undefined)).toBeUndefined();
  });
  it('returns undefined on circular / non-serializable input', () => {
    const o: { self?: unknown } = {};
    o.self = o;
    expect(serializeValue(o)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// hookCoordinator - end-to-end with a fake Mosaic + fake polychrome API
// ---------------------------------------------------------------------------

interface FakeSelection {
  id?: string;
  value: unknown;
  listeners: Set<(v: unknown) => void>;
  addEventListener(_e: 'value', cb: (v: unknown) => void): void;
  removeEventListener(_e: 'value', cb: (v: unknown) => void): void;
  update(predicate: unknown, _source: unknown): void;
  emit(): void;
}

function makeSelection(id: string, initial: unknown = null): FakeSelection {
  const listeners = new Set<(v: unknown) => void>();
  return {
    id,
    value: initial,
    listeners,
    addEventListener(_e, cb) { listeners.add(cb); },
    removeEventListener(_e, cb) { listeners.delete(cb); },
    update(predicate, _source) { this.value = predicate; this.emit(); },
    emit() { for (const cb of this.listeners) cb(this.value); },
  };
}

interface FakeShare {
  get: () => unknown;
  set: (v: unknown) => void;
  subscribe: (cb: (v: unknown) => void) => () => void;
  __subs: Set<(v: unknown) => void>;
  __value: unknown;
}

function fakeApi(): {
  api: AdapterContext['api'];
  shares: Map<string, FakeShare>;
} {
  const shares = new Map<string, FakeShare>();
  function makeShare(key: string, initial?: unknown): FakeShare {
    let value = initial;
    const subs = new Set<(v: unknown) => void>();
    const handle: FakeShare = {
      get: () => value,
      set: (v) => { value = v; for (const cb of subs) cb(v); },
      subscribe: (cb) => {
        subs.add(cb);
        if (value !== undefined) cb(value);
        return () => subs.delete(cb);
      },
      __subs: subs,
      __value: value,
    };
    return handle;
  }
  const api = {
    share<T>(key: string, initial?: T) {
      let s = shares.get(key);
      if (!s) { s = makeShare(key, initial); shares.set(key, s); }
      return s as unknown as ReturnType<AdapterContext['api']['share']>;
    },
    list<T>(_id: string) { throw new Error('not used in mosaic test'); },
    checkpoint() { /* unused */ },
    self: { actorId: 'A', name: 'a', color: '#fff' },
  } as unknown as AdapterContext['api'];
  return { api, shares };
}

function makeCtx(api: AdapterContext['api']): AdapterContext {
  return {
    api,
    self: { actorId: 'A', name: 'a', color: '#fff' },
    log: vi.fn(),
    warn: vi.fn(),
  };
}

describe('hookCoordinator', () => {
  it('local selection change broadcasts via share()', () => {
    const sel = makeSelection('brush', null);
    const coord = { selections: new Map([['brush', sel]]) };
    const { api, shares } = fakeApi();
    const teardown = hookCoordinator(coord, makeCtx(api));

    sel.value = { col: 'x', range: [1, 5] };
    sel.emit();

    const share = shares.get('mosaic.selection.brush');
    expect(share).toBeDefined();
    expect(share!.get()).toEqual({ col: 'x', range: [1, 5] });
    teardown();
  });

  it('remote share update calls selection.update(value, polychromeSource)', () => {
    const sel = makeSelection('brush', null);
    const updateSpy = vi.spyOn(sel, 'update');
    const coord = { selections: new Map([['brush', sel]]) };
    const { api } = fakeApi();
    const ctx = makeCtx(api);
    const teardown = hookCoordinator(coord, ctx);

    // Pretend a peer updated the share. We invoke set() on the same handle
    // the adapter subscribed to.
    api.share('mosaic.selection.brush').set({ col: 'x', range: [10, 20] });
    expect(updateSpy).toHaveBeenCalled();
    expect((updateSpy.mock.calls[0]?.[0] as unknown)).toEqual({ col: 'x', range: [10, 20] });
    // The second arg should be a non-null source sentinel.
    expect(updateSpy.mock.calls[0]?.[1]).not.toBeNull();
    teardown();
  });

  it('does not bounce remote updates back as broadcasts (no echo)', () => {
    const sel = makeSelection('brush', null);
    const coord = { selections: new Map([['brush', sel]]) };
    const { api, shares } = fakeApi();
    const teardown = hookCoordinator(coord, makeCtx(api));

    const share = api.share('mosaic.selection.brush');
    let setCount = 0;
    const orig = (share as { set: (v: unknown) => void }).set.bind(share);
    (share as { set: (v: unknown) => void }).set = (v: unknown) => {
      setCount++;
      orig(v);
    };

    // Remote pushes -> selection.update fires -> selection emits 'value' ->
    // our listener serializes and would normally call share.set; the
    // adapter must dedupe so this does NOT increment.
    share.set({ col: 'x', range: [1, 2] });
    expect(setCount).toBe(1);
    void shares;
    teardown();
  });

  it('skips selections that have no addEventListener', () => {
    const incomplete = { id: 'broken', value: null } as unknown as Parameters<typeof hookCoordinator>[0]['selections'] extends Map<string, infer T> ? T : never;
    const coord = { selections: new Map([['broken', incomplete]]) } as unknown as Parameters<typeof hookCoordinator>[0];
    const { api } = fakeApi();
    const ctx = makeCtx(api);
    const teardown = hookCoordinator(coord, ctx);
    expect(ctx.log).toHaveBeenCalled();
    teardown();
  });

  it('teardown removes selection listeners', () => {
    const sel = makeSelection('brush', null);
    const coord = { selections: new Map([['brush', sel]]) };
    const { api } = fakeApi();
    const teardown = hookCoordinator(coord, makeCtx(api));
    expect(sel.listeners.size).toBe(1);
    teardown();
    expect(sel.listeners.size).toBe(0);
  });
});
