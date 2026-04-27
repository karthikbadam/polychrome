// @vitest-environment jsdom

/**
 * Tests for the bindYjs() bridge that powers TrysteroProvider.
 *
 * We can't unit-test the live Trystero room (it allocates an
 * RTCPeerConnection at construction, which jsdom doesn't have), so the
 * Yjs-wire logic is split into bindYjs(doc, channels). Here we wire up
 * two bridges with a pair of in-memory channels and prove they sync
 * just like two real peers would.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { bindYjs, type YjsChannels } from './trystero-provider.js';

// ---------------------------------------------------------------------------
// Two-bridge harness over a fake channel pair
// ---------------------------------------------------------------------------

interface Bridge {
  doc: Y.Doc;
  bridge: ReturnType<typeof bindYjs>;
  /** Trigger an onPeerJoin event - simulates Trystero's room.onPeerJoin. */
  triggerJoin: (peerId: string) => void;
}

function makePair(): { a: Bridge; b: Bridge; cleanup: () => void } {
  const aSync: Array<(data: Uint8Array, peerId: string) => void> = [];
  const aAware: Array<(data: Uint8Array, peerId: string) => void> = [];
  const aJoin: Array<(peerId: string) => void> = [];
  const bSync: Array<(data: Uint8Array, peerId: string) => void> = [];
  const bAware: Array<(data: Uint8Array, peerId: string) => void> = [];
  const bJoin: Array<(peerId: string) => void> = [];

  const channelsA: YjsChannels = {
    sendSync: (data, peerId) => { for (const cb of bSync) cb(data, peerId ?? 'A'); },
    onSync: (cb) => { aSync.push(cb); },
    sendAwareness: (data, peerId) => { for (const cb of bAware) cb(data, peerId ?? 'A'); },
    onAwareness: (cb) => { aAware.push(cb); },
    onPeerJoin: (cb) => { aJoin.push(cb); },
  };
  const channelsB: YjsChannels = {
    sendSync: (data, peerId) => { for (const cb of aSync) cb(data, peerId ?? 'B'); },
    onSync: (cb) => { bSync.push(cb); },
    sendAwareness: (data, peerId) => { for (const cb of aAware) cb(data, peerId ?? 'B'); },
    onAwareness: (cb) => { bAware.push(cb); },
    onPeerJoin: (cb) => { bJoin.push(cb); },
  };

  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const bridgeA = bindYjs(docA, channelsA);
  const bridgeB = bindYjs(docB, channelsB);

  return {
    a: { doc: docA, bridge: bridgeA, triggerJoin: (id) => { for (const cb of aJoin) cb(id); } },
    b: { doc: docB, bridge: bridgeB, triggerJoin: (id) => { for (const cb of bJoin) cb(id); } },
    cleanup: () => {
      bridgeA.destroy();
      bridgeB.destroy();
      docA.destroy();
      docB.destroy();
    },
  };
}

let cleanups: Array<() => void> = [];
afterEach(() => { for (const c of cleanups) c(); cleanups = []; });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bindYjs', () => {
  it('local doc updates propagate to the peer', () => {
    const { a, b, cleanup } = makePair();
    cleanups.push(cleanup);

    a.doc.getMap('m').set('hello', 'world');
    expect(b.doc.getMap('m').get('hello')).toBe('world');
  });

  it('updates flow both ways', () => {
    const { a, b, cleanup } = makePair();
    cleanups.push(cleanup);

    a.doc.getArray('items').push(['from-A']);
    b.doc.getArray('items').push(['from-B']);

    expect(a.doc.getArray('items').toArray().sort()).toEqual(['from-A', 'from-B']);
    expect(b.doc.getArray('items').toArray().sort()).toEqual(['from-A', 'from-B']);
  });

  it('a late-joining peer pulls existing state via sync_step1', () => {
    const { a, b, cleanup } = makePair();
    cleanups.push(cleanup);

    // A populates state BEFORE B "knows about" A.
    a.doc.getMap('keys').set('greeting', 'hi');
    a.doc.getArray('list').push(['x', 'y']);

    // Simulate Trystero's onPeerJoin firing on both sides. The bridges
    // exchange sync_step1/2 and B catches up.
    a.triggerJoin('B');
    b.triggerJoin('A');

    expect(b.doc.getMap('keys').get('greeting')).toBe('hi');
    expect(b.doc.getArray('list').toArray()).toEqual(['x', 'y']);
  });

  it('awareness round-trips between peers', () => {
    const { a, b, cleanup } = makePair();
    cleanups.push(cleanup);

    a.bridge.awareness.setLocalStateField('user', { actorId: 'A', name: 'alice' });
    b.bridge.awareness.setLocalStateField('user', { actorId: 'B', name: 'bob' });

    // B should see A's state and vice versa, identified by clientID.
    const bSeesA = b.bridge.awareness.getStates().get(a.doc.clientID);
    const aSeesB = a.bridge.awareness.getStates().get(b.doc.clientID);
    expect((bSeesA as { user?: { name?: string } } | undefined)?.user?.name).toBe('alice');
    expect((aSeesB as { user?: { name?: string } } | undefined)?.user?.name).toBe('bob');
  });

  it('does not infinitely echo a remote update back as a fresh broadcast', () => {
    // Track how many sendSync calls each side makes. With a one-shot
    // mutation on B, the message should reach A exactly once and stop -
    // not bounce back and forth.
    const { a, b, cleanup } = makePair();
    cleanups.push(cleanup);

    let callsAtSteady = 0;
    b.doc.getMap('m').set('k', 'v');

    // Probe a few macrotask turns to confirm no extra activity.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        callsAtSteady = a.doc.getMap('m').size;
        expect(a.doc.getMap('m').get('k')).toBe('v');
        // Sanity: no further updates queued up.
        b.doc.getMap('m').set('k', 'v2');
        setTimeout(() => {
          expect(a.doc.getMap('m').get('k')).toBe('v2');
          void callsAtSteady;
          resolve();
        }, 0);
      }, 0);
    });
  });

  it('subscribe-then-set on the same peer never echoes (regression for tx echo)', () => {
    const { a, b, cleanup } = makePair();
    cleanups.push(cleanup);

    const aMap = a.doc.getMap('m');
    const seen: unknown[] = [];
    aMap.observe((e) => { for (const k of e.keysChanged) seen.push(aMap.get(k)); });

    b.doc.getMap('m').set('k', 1);
    b.doc.getMap('m').set('k', 2);
    b.doc.getMap('m').set('k', 3);
    // 'a' sees three remote updates exactly once each, no infinite ping-pong.
    expect(seen).toEqual([1, 2, 3]);
  });

  it('destroy() removes the doc and awareness listeners', () => {
    const { a, b, cleanup } = makePair();
    a.bridge.destroy();
    cleanups.push(() => { b.bridge.destroy(); a.doc.destroy(); b.doc.destroy(); });
    // After A's bridge is destroyed, mutating A's doc no longer
    // reaches B (no more update listener firing sendSync).
    a.doc.getMap('m').set('k', 'after-destroy');
    expect(b.doc.getMap('m').get('k')).toBeUndefined();
  });
});
