/**
 * signaling/adapters/conformance.ts
 *
 * Shared conformance test suite for SignalingAdapter implementations.
 *
 * Usage: call `runAdapterConformance(name, factory)` from inside a describe
 * block in your adapter's *.test.ts.  The factory must return a
 * { local, remote } pair of adapters that are already wired together via a
 * mock/in-process transport (no real network I/O in unit tests).
 *
 * Example:
 *   describe('my-adapter conformance', () => {
 *     runAdapterConformance('my-adapter', () => makeLinkedPair());
 *   });
 */

import type { ActorId, SessionId } from '@polychrome/protocol';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AdapterSignalingMessage, SignalingAdapter } from '../adapter.js';

// ---------------------------------------------------------------------------
// Test IDs (cast through unknown because branded types)
// ---------------------------------------------------------------------------
const SESSION_A = 'AAAAAA' as unknown as SessionId;
const ACTOR_LOCAL  = '00000000-0000-0000-0000-000000000001' as unknown as ActorId;
const ACTOR_REMOTE = '00000000-0000-0000-0000-000000000002' as unknown as ActorId;

/** Factory must return a linked pair where messages sent by `local` are
 *  delivered to `remote` and vice-versa via an in-process transport. */
export interface AdapterPair {
  local: SignalingAdapter;
  remote: SignalingAdapter;
}

type AdapterPairFactory = () => AdapterPair | Promise<AdapterPair>;

/** Run the full conformance suite against an adapter pair. */
export function runAdapterConformance(
  adapterName: string,
  makeLinkedPair: AdapterPairFactory,
): void {
  describe(`${adapterName} - conformance`, () => {
    let local: SignalingAdapter;
    let remote: SignalingAdapter;

    beforeEach(async () => {
      const pair = await makeLinkedPair();
      local = pair.local;
      remote = pair.remote;
      await local.join(SESSION_A, ACTOR_LOCAL);
      await remote.join(SESSION_A, ACTOR_REMOTE);
    });

    afterEach(async () => {
      await local.leave();
      await remote.leave();
    });

    it('delivers a message from local to remote', async () => {
      const received: Array<{ from: ActorId; msg: AdapterSignalingMessage }> = [];

      const unsub = remote.onMessage((from, msg) => {
        received.push({ from, msg });
      });

      const sent: AdapterSignalingMessage = { type: 'hello', proto: 1 };
      await local.sendTo(ACTOR_REMOTE, sent);

      // Allow microtask/event-loop to flush
      await new Promise((r) => setTimeout(r, 0));

      expect(received).toHaveLength(1);
      expect(received[0]?.from).toBe(ACTOR_LOCAL);
      expect(received[0]?.msg).toEqual(sent);

      unsub();
    });

    it('delivers a message from remote to local', async () => {
      const received: Array<{ from: ActorId; msg: AdapterSignalingMessage }> = [];

      const unsub = local.onMessage((from, msg) => {
        received.push({ from, msg });
      });

      const sent: AdapterSignalingMessage = { type: 'offer', sdp: 'v=0\r\n' };
      await remote.sendTo(ACTOR_LOCAL, sent);

      await new Promise((r) => setTimeout(r, 0));

      expect(received).toHaveLength(1);
      expect(received[0]?.from).toBe(ACTOR_REMOTE);
      expect(received[0]?.msg).toEqual(sent);

      unsub();
    });

    it('fires onPeerJoin for the remote when remote joins', async () => {
      // We test the event after a fresh join cycle
      const joins: ActorId[] = [];
      const unsub = local.onPeerJoin((id) => joins.push(id));

      // Leave and rejoin remote so the join event fires on local
      await remote.leave();
      await remote.join(SESSION_A, ACTOR_REMOTE);

      await new Promise((r) => setTimeout(r, 10));

      // At minimum one join should have been recorded (some adapters may fire
      // it even on the initial join above; allow ≥1).
      expect(joins.length).toBeGreaterThanOrEqual(1);
      expect(joins).toContain(ACTOR_REMOTE);

      unsub();
    });

    it('fires onPeerLeave when remote leaves', async () => {
      const leaves: ActorId[] = [];
      const unsub = local.onPeerLeave((id) => leaves.push(id));

      await remote.leave();

      await new Promise((r) => setTimeout(r, 10));

      expect(leaves).toContain(ACTOR_REMOTE);

      unsub();
    });

    it('unsubscribing stops message delivery', async () => {
      const received: AdapterSignalingMessage[] = [];
      const unsub = remote.onMessage((_from, msg) => received.push(msg));

      unsub(); // unsubscribe immediately

      await local.sendTo(ACTOR_REMOTE, { type: 'hello', proto: 1 });
      await new Promise((r) => setTimeout(r, 0));

      expect(received).toHaveLength(0);
    });

    it('sendTo queues or throws when not joined', async () => {
      const fresh = (await makeLinkedPair()).local;
      // Not joined yet
      await expect(
        fresh.sendTo(ACTOR_REMOTE, { type: 'hello', proto: 1 }),
      ).rejects.toThrow();
    });
  });
}
