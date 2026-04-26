/**
 * api.test.ts — exercises createPolyApi() with two locally-connected
 * Y.Doc instances, no transport. Each test sets up:
 *
 *   docA  ←—  manualSync  —→  docB
 *
 * where manualSync wires update events both ways. This is the same effect
 * as a fully-functional WebRTC link without the network.
 */

import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type PolyApi, createPolyApi } from './api.js';

// ---------------------------------------------------------------------------
// Two-doc harness
// ---------------------------------------------------------------------------

interface Pair {
  docA: Y.Doc;
  docB: Y.Doc;
  apiA: PolyApi;
  apiB: PolyApi;
  unwire: () => void;
}

function pair(): Pair {
  const docA = new Y.Doc();
  const docB = new Y.Doc();

  // Forward every local update from one doc to the other. The 'update'
  // event fires for BOTH local and applied-from-remote updates, so we
  // tag remote applications with a non-self origin to break the loop.
  const FROM_A = Symbol('from-A');
  const FROM_B = Symbol('from-B');
  const onA = (update: Uint8Array, origin: unknown): void => {
    if (origin === FROM_B) return;
    Y.applyUpdate(docB, update, FROM_A);
  };
  const onB = (update: Uint8Array, origin: unknown): void => {
    if (origin === FROM_A) return;
    Y.applyUpdate(docA, update, FROM_B);
  };
  docA.on('update', onA);
  docB.on('update', onB);

  const apiA = createPolyApi(docA, { actorId: 'A', name: 'alice', color: '#aaa' });
  const apiB = createPolyApi(docB, { actorId: 'B', name: 'bob',   color: '#bbb' });

  return {
    docA,
    docB,
    apiA,
    apiB,
    unwire: () => {
      docA.off('update', onA);
      docB.off('update', onB);
    },
  };
}

let p: Pair;
beforeEach(() => { p = pair(); });
afterEach(() => { p.unwire(); p.docA.destroy(); p.docB.destroy(); });

// ---------------------------------------------------------------------------
// share()
// ---------------------------------------------------------------------------

describe('share()', () => {
  it('round-trip on the same peer', () => {
    const x = p.apiA.share<number>('count');
    x.set(42);
    expect(x.get()).toBe(42);
  });

  it('propagates a set from A to B', () => {
    p.apiA.share<number>('count').set(7);
    expect(p.apiB.share<number>('count').get()).toBe(7);
  });

  it('propagates a set from B to A (bidirectional)', () => {
    p.apiB.share<string>('label').set('hello');
    expect(p.apiA.share<string>('label').get()).toBe('hello');
  });

  it('subscribe fires once with the current value when already present', () => {
    p.apiA.share<number>('n').set(99);
    const seen: number[] = [];
    p.apiB.share<number>('n').subscribe(v => seen.push(v));
    expect(seen).toEqual([99]);
  });

  it('subscribe fires on remote changes', () => {
    const seen: number[] = [];
    p.apiB.share<number>('n').subscribe(v => seen.push(v));
    p.apiA.share<number>('n').set(1);
    p.apiA.share<number>('n').set(2);
    p.apiA.share<number>('n').set(3);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('subscribe does NOT fire on self-originated changes (no echo loop)', () => {
    const handle = p.apiA.share<number>('n');
    const seen: number[] = [];
    handle.subscribe(v => seen.push(v));
    handle.set(1);
    handle.set(2);
    expect(seen).toEqual([]);
  });

  it('unsubscribe stops further callbacks', () => {
    const seen: number[] = [];
    const off = p.apiB.share<number>('n').subscribe(v => seen.push(v));
    p.apiA.share<number>('n').set(1);
    off();
    p.apiA.share<number>('n').set(2);
    expect(seen).toEqual([1]);
  });

  it('initial value seeds after 500ms only if not already present', async () => {
    // A seeds first, B's later seed must NOT clobber it.
    p.apiA.share<string>('greeting', 'hi-from-A');
    await new Promise(r => setTimeout(r, 600));
    p.apiB.share<string>('greeting', 'hi-from-B');
    await new Promise(r => setTimeout(r, 600));
    expect(p.apiA.share<string>('greeting').get()).toBe('hi-from-A');
    expect(p.apiB.share<string>('greeting').get()).toBe('hi-from-A');
  });

  it('typed values: arrays and objects round-trip', () => {
    p.apiA.share<{ x: number; y: number }>('pos').set({ x: 3, y: 4 });
    p.apiA.share<number[]>('idx').set([1, 2, 3]);
    expect(p.apiB.share<{ x: number; y: number }>('pos').get()).toEqual({ x: 3, y: 4 });
    expect(p.apiB.share<number[]>('idx').get()).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// list()
// ---------------------------------------------------------------------------

describe('list()', () => {
  it('round-trip insert/get on the same peer', () => {
    const l = p.apiA.list<string>('strokes');
    l.insert(0, 'a'); l.insert(1, 'b'); l.insert(2, 'c');
    expect(l.get()).toEqual(['a', 'b', 'c']);
  });

  it('propagates inserts from A to B', () => {
    p.apiA.list<string>('strokes').insert(0, 'a');
    p.apiA.list<string>('strokes').insert(1, 'b');
    expect(p.apiB.list<string>('strokes').get()).toEqual(['a', 'b']);
  });

  it('propagates inserts from B to A (bidirectional)', () => {
    p.apiB.list<string>('strokes').insert(0, 'x');
    p.apiB.list<string>('strokes').insert(1, 'y');
    expect(p.apiA.list<string>('strokes').get()).toEqual(['x', 'y']);
  });

  it('interleaved inserts from both peers converge', () => {
    p.apiA.list<string>('s').insert(0, 'a1');
    p.apiB.list<string>('s').insert(1, 'b1');
    p.apiA.list<string>('s').insert(2, 'a2');
    p.apiB.list<string>('s').insert(3, 'b2');
    // Both peers see the same sequence (CRDT convergence).
    expect(p.apiA.list<string>('s').get()).toEqual(p.apiB.list<string>('s').get());
    expect(p.apiA.list<string>('s').get()).toHaveLength(4);
  });

  it('delete propagates', () => {
    const a = p.apiA.list<string>('s');
    a.insert(0, 'a'); a.insert(1, 'b'); a.insert(2, 'c');
    p.apiB.list<string>('s').delete(1);
    expect(a.get()).toEqual(['a', 'c']);
  });

  it('subscribe fires immediately with current contents (late-join replay)', () => {
    p.apiA.list<string>('s').insert(0, 'first');
    p.apiA.list<string>('s').insert(1, 'second');
    p.apiA.list<string>('s').insert(2, 'third');
    // B "joins late" and subscribes — should see all three immediately.
    const seen: string[][] = [];
    p.apiB.list<string>('s').subscribe(items => seen.push(items));
    expect(seen).toEqual([['first', 'second', 'third']]);
  });

  it('subscribe fires with full array on every remote change', () => {
    const seen: string[][] = [];
    p.apiB.list<string>('s').subscribe(items => seen.push(items));
    p.apiA.list<string>('s').insert(0, 'x');
    p.apiA.list<string>('s').insert(1, 'y');
    // Initial cb (empty) + two remote inserts.
    expect(seen).toEqual([[], ['x'], ['x', 'y']]);
  });

  it('subscribe does NOT fire on self-originated inserts', () => {
    const a = p.apiA.list<string>('s');
    const seen: string[][] = [];
    a.subscribe(items => seen.push(items));
    a.insert(0, 'self');
    a.insert(1, 'self2');
    // Only the initial fire (empty), no echoes for self-mutations.
    expect(seen).toEqual([[]]);
  });

  it('multiple lists are isolated', () => {
    p.apiA.list<string>('strokes').insert(0, 'stroke1');
    p.apiA.list<string>('checkpoints').insert(0, 'cp1');
    expect(p.apiB.list<string>('strokes').get()).toEqual(['stroke1']);
    expect(p.apiB.list<string>('checkpoints').get()).toEqual(['cp1']);
  });
});

// ---------------------------------------------------------------------------
// Late join scenario — full replay
// ---------------------------------------------------------------------------

describe('late join replay', () => {
  it('a peer joining after activity sees full state', () => {
    // Simulate: A is alone, draws 5 strokes. B joins later.
    const docA = new Y.Doc();
    const apiA = createPolyApi(docA, { actorId: 'A', name: 'alice', color: '#aaa' });
    apiA.list<string>('strokes').insert(0, 's1');
    apiA.list<string>('strokes').insert(1, 's2');
    apiA.list<string>('strokes').insert(2, 's3');
    apiA.list<string>('strokes').insert(3, 's4');
    apiA.list<string>('strokes').insert(4, 's5');
    apiA.share<number>('year').set(2023);

    // B joins: snapshot transfer happens via Y.applyUpdate(stateAsUpdate).
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const apiB = createPolyApi(docB, { actorId: 'B', name: 'bob', color: '#bbb' });

    expect(apiB.list<string>('strokes').get()).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(apiB.share<number>('year').get()).toBe(2023);

    // B subscribes — receives all 5 via the immediate-fire on subscribe.
    const seen: string[][] = [];
    apiB.list<string>('strokes').subscribe(items => seen.push(items));
    expect(seen[0]).toEqual(['s1', 's2', 's3', 's4', 's5']);

    docA.destroy();
    docB.destroy();
  });
});

// ---------------------------------------------------------------------------
// checkpoint
// ---------------------------------------------------------------------------

describe('checkpoint()', () => {
  it('appends to a shared checkpoints list visible to peers', () => {
    p.apiA.checkpoint('insight A');
    p.apiB.checkpoint('insight B');
    const a = p.apiA.list<{ label: string; by: string }>('checkpoints').get();
    const b = p.apiB.list<{ label: string; by: string }>('checkpoints').get();
    expect(a).toEqual(b);
    expect(a.map(c => c.label).sort()).toEqual(['insight A', 'insight B']);
  });
});

// ---------------------------------------------------------------------------
// Echo-loop regression — the scatterplot/choropleth pattern
// ---------------------------------------------------------------------------

describe('echo loop regression', () => {
  it("subscribe-then-set on the same peer doesn't ping-pong", () => {
    // Simulates the demo's pattern: `vp.subscribe(v => { ...render UI which
    // re-emits...; vp.set(v) })`. Without origin filtering this would
    // generate an op for every update.
    const a = p.apiA.share<number>('viewport');
    let count = 0;
    a.subscribe((v) => {
      count++;
      // The demo pattern: re-emit on every update we see. With origin
      // filtering this only fires on remote updates and never echoes
      // the same value back as a fresh op.
      a.set(v);
    });
    p.apiB.share<number>('viewport').set(1);
    p.apiB.share<number>('viewport').set(2);
    p.apiB.share<number>('viewport').set(3);
    // count should be exactly 3 (three remote updates), not unbounded.
    expect(count).toBe(3);
  });
});
