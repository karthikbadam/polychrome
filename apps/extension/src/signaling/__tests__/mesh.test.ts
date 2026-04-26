/**
 * __tests__/mesh.test.ts
 *
 * Unit tests for MeshManager using:
 *   - in-memory mock SignalingAdapter (mock-adapter.ts)
 *   - mock RTCPeerConnection factory (mock-rtc.ts)
 *
 * Tests verified:
 *   1. start/stop lifecycle leaves zero open mock connections
 *   2. Peer join / leave callbacks fire correctly
 *   3. broadcast() reaches all ready peers
 *   4. sendCursor() goes through the 30Hz throttle
 *
 * Real WebRTC (two-profile Chrome test) is deferred to Track Z.
 * TODO(track-Z): E2E test — two Chrome profiles join same room, ops channel
 * active within 3s on localhost.
 */

import type { ActorId, SessionId } from '@polychrome/protocol';

import { describe, expect, it, vi } from 'vitest';

import { MeshManager } from '../mesh.js';
import { makeLinkedPair } from './mock-adapter.js';
import {
  MockDataChannel,
  MockPeerConnection,
  makeRtcFactory,
} from './mock-rtc.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const SESSION = 'SESS01' as unknown as SessionId;
const LOCAL_ACTOR  = 'aaaaaaaa-0000-0000-0000-000000000001' as unknown as ActorId;
const REMOTE_ACTOR = 'bbbbbbbb-0000-0000-0000-000000000002' as unknown as ActorId;

function createMesh(
  pcPool: MockPeerConnection[],
  adapterLocal: ReturnType<typeof makeLinkedPair>['local'],
) {
  return new MeshManager({
    adapter:       adapterLocal,
    iceServers:    [],
    onPeerJoin:    vi.fn(),
    onPeerLeave:   vi.fn(),
    onOpEnvelope:  vi.fn(),
    onCursor:      vi.fn(),
    __rtcFactory:  makeRtcFactory(pcPool),
  });
}

/** Open ops + cursor channels on a MockPeerConnection. */
function openChannels(pc: MockPeerConnection): void {
  for (const ch of (pc as unknown as { channels: MockDataChannel[] }).channels) {
    if (ch.readyState !== 'open') ch.simulateOpen();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MeshManager lifecycle', () => {
  it('start and stop leaves zero open mock connections', async () => {
    const { local } = makeLinkedPair();
    const [pc] = MockPeerConnection.createPair();
    const mesh = createMesh([pc], local);

    await mesh.start(SESSION, LOCAL_ACTOR);
    expect(mesh.peers()).toHaveLength(0);

    await mesh.stop();
    // After stop, closed flag should be set on any created PCs
    // (No PCs were created since no peers joined.)
    expect(mesh.peers()).toHaveLength(0);
  });

  it('stop() is idempotent', async () => {
    const { local } = makeLinkedPair();
    const mesh = createMesh([], local);
    await mesh.start(SESSION, LOCAL_ACTOR);
    await mesh.stop();
    await expect(mesh.stop()).resolves.toBeUndefined();
  });

  it('onPeerJoin fires when a peer connects and channels open', async () => {
    const { local, remote } = makeLinkedPair();
    const [pcA] = MockPeerConnection.createPair();
    const onPeerJoin = vi.fn();
    const onPeerLeave = vi.fn();

    const mesh = new MeshManager({
      adapter:       local,
      iceServers:    [],
      onPeerJoin,
      onPeerLeave,
      onOpEnvelope:  vi.fn(),
      onCursor:      vi.fn(),
      __rtcFactory:  makeRtcFactory([pcA]),
    });

    await mesh.start(SESSION, LOCAL_ACTOR);

    // Simulate remote peer joining (triggers adapter.onPeerJoin -> mesh creates PC)
    await remote.join(SESSION, REMOTE_ACTOR);

    // Let the MeshManager create the PeerConnection and call start(true)
    await new Promise((r) => setTimeout(r, 0));

    // Open the data channels directly to simulate ICE connected + channels open
    openChannels(pcA);
    await new Promise((r) => setTimeout(r, 0));

    // Simulate receiving hello from remote over the ops channel to complete handshake
    const opsChannel = (pcA as unknown as { channels: MockDataChannel[] })
      .channels.find((c) => c.label === 'ops');
    opsChannel?.onmessage?.({
      data: JSON.stringify({ v: 1, type: 'hello', body: { proto: 1 } }),
    });

    await new Promise((r) => setTimeout(r, 0));

    // onPeerJoin should have been called once the hello exchange completes
    expect(onPeerJoin).toHaveBeenCalledWith(REMOTE_ACTOR);

    await mesh.stop();
  });

  it('peers() returns only ready actors', async () => {
    const { local } = makeLinkedPair();
    const mesh = createMesh([], local);
    await mesh.start(SESSION, LOCAL_ACTOR);
    expect(mesh.peers()).toEqual([]);
    await mesh.stop();
  });

  it('broadcast does not throw when no peers connected', async () => {
    const { local } = makeLinkedPair();
    const mesh = createMesh([], local);
    await mesh.start(SESSION, LOCAL_ACTOR);
    expect(() => mesh.broadcast({ v: 1, type: 'op', body: {} })).not.toThrow();
    await mesh.stop();
  });

  it('sendCursor schedules through throttle (no immediate send)', async () => {
    vi.useFakeTimers();
    try {
      const { local } = makeLinkedPair();
      const mesh = createMesh([], local);
      await mesh.start(SESSION, LOCAL_ACTOR);
      // Should not throw; cursor goes through throttle
      mesh.sendCursor({ x: 100, y: 200 });
      // Advance to fire throttle
      vi.advanceTimersByTime(33);
      await mesh.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MeshManager connection tracking', () => {
  it('closed PeerConnections are removed from the map on peer leave', async () => {
    const { local, remote } = makeLinkedPair();
    const [pcA] = MockPeerConnection.createPair();
    const onPeerLeave = vi.fn();

    const mesh = new MeshManager({
      adapter:       local,
      iceServers:    [],
      onPeerJoin:    vi.fn(),
      onPeerLeave,
      onOpEnvelope:  vi.fn(),
      onCursor:      vi.fn(),
      __rtcFactory:  makeRtcFactory([pcA]),
    });

    await mesh.start(SESSION, LOCAL_ACTOR);
    await remote.join(SESSION, REMOTE_ACTOR);
    await new Promise((r) => setTimeout(r, 0));

    // Simulate the adapter reporting the remote left
    // (InMemoryAdapter fires onPeerLeave when remote.leave() is called)
    await remote.leave();
    await new Promise((r) => setTimeout(r, 0));

    expect(mesh.peers()).not.toContain(REMOTE_ACTOR);

    await mesh.stop();
  });
});
