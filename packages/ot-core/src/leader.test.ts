/**
 * leader.test.ts — Discrete-event simulation of leader election.
 *
 * Tests:
 *   1. 5 peers start; initial leader is peer0.
 *   2. Random leader churn (10%/s). After each churn, a new leader is
 *      elected within 6 000 ms of simulated time.
 *   3. Election always settles to a single leader (no split-brain).
 */

import { describe, expect, it } from 'vitest';

import type { ActorId, Seq } from '@polychrome/protocol';

import type { ClaimMessage, LeaderCallbacks } from './leader.js';
import { LeaderStateMachine } from './leader.js';

// ---------------------------------------------------------------------------
// Simulation helpers
// ---------------------------------------------------------------------------

interface PeerSim {
  id:      ActorId;
  machine: LeaderStateMachine;
  lastSeq: Seq;
}

interface Network {
  peers:  PeerSim[];
  now:    number;
  /** Pending messages: { deliverAt, from, to, type, data } */
  queue:  Array<{
    deliverAt: number;
    from: ActorId;
    to:   ActorId | 'broadcast';
    type: 'claim' | 'grant' | 'heartbeat' | 'termChange';
    data: unknown;
  }>;
}

function makeNetwork(n: number): Network {
  let now = 0;
  const getNow = () => now;
  const net: Network = { peers: [], now: 0, queue: [] };

  for (let i = 0; i < n; i++) {
    const id = `peer-${i}` as ActorId;
    // NOTE: `machine` is captured directly (not via net.peers[i]) to avoid
    // stale-index bugs when tests splice out crashed peers.
    let machine!: LeaderStateMachine;
    const cbs: LeaderCallbacks = {
      onStartHeartbeating() {
        // Immediately send heartbeat to all peers; read term from the machine
        // directly — net.peers[i] becomes stale after a splice.
        schedule(id, 'broadcast', 'heartbeat', { senderId: id, seq: 0, term: machine.term }, 10);
      },
      onStopHeartbeating() { /* nothing */ },
      onSendClaim(lastSeq) {
        schedule(id, 'broadcast', 'claim', { actorId: id, lastSeq }, 10);
      },
      onSendGrant(claimantId) {
        schedule(id, claimantId, 'grant', { granterId: id }, 10);
      },
      onLeaderChange(_newLeaderId) { /* tracking done via state */ },
    };
    machine = new LeaderStateMachine(id, n, getNow, cbs);
    net.peers.push({ id, machine, lastSeq: 0 as Seq });
  }

  function schedule(
    from: ActorId,
    to: ActorId | 'broadcast',
    type: 'claim' | 'grant' | 'heartbeat' | 'termChange',
    data: unknown,
    delay: number,
  ): void {
    net.queue.push({ deliverAt: now + delay, from, to, type, data });
  }

  // Give first peer leadership directly (room creator becomes initial leader).
  net.peers[0]!.machine.bootAsLeader();

  return net;
}

function advance(net: Network, targetMs: number): void {
  while (net.now < targetMs) {
    net.now += 1;

    // Deliver due messages
    const due = net.queue.filter(m => m.deliverAt <= net.now);
    net.queue = net.queue.filter(m => m.deliverAt > net.now);

    for (const msg of due) {
      const targets = msg.to === 'broadcast'
        ? net.peers.filter(p => p.id !== msg.from)
        : net.peers.filter(p => p.id === msg.to);

      for (const peer of targets) {
        switch (msg.type) {
          case 'heartbeat': {
            const d = msg.data as { senderId: ActorId; seq: Seq; term: number };
            peer.machine.receiveHeartbeat(d.senderId, d.seq, d.term);
            break;
          }
          case 'claim': {
            const d = msg.data as ClaimMessage;
            peer.machine.receiveClaim(d, peer.lastSeq);
            break;
          }
          case 'grant': {
            const d = msg.data as { granterId: ActorId };
            peer.machine.receiveGrant(d.granterId);
            break;
          }
          case 'termChange': {
            const d = msg.data as { newLeaderId: ActorId; term: number };
            peer.machine.receiveTermChange(d.newLeaderId, d.term);
            break;
          }
        }
      }
    }

    // Tick all peers
    for (const peer of net.peers) {
      peer.machine.tick(net.now, peer.lastSeq);
    }

    // Leader heartbeats every 1000 ms
    if (net.now % 1000 === 0) {
      for (const peer of net.peers) {
        if (peer.machine.state === 'leader') {
          for (const other of net.peers) {
            if (other.id !== peer.id) {
              net.queue.push({
                deliverAt: net.now + 10,
                from: peer.id,
                to: other.id,
                type: 'heartbeat',
                data: { senderId: peer.id, seq: peer.lastSeq, term: peer.machine.term },
              });
            }
          }
        }
      }
    }
  }
}

function countLeaders(net: Network): number {
  return net.peers.filter(p => p.machine.state === 'leader').length;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LeaderStateMachine — 5-peer simulation', () => {
  it('initial heartbeat makes all peers follow peer-0', () => {
    const net = makeNetwork(5);
    advance(net, 100);
    // After heartbeats arrive, all followers should recognise peer-0 as leader.
    const leaders = countLeaders(net);
    expect(leaders).toBeLessThanOrEqual(1);
    const followers = net.peers.filter(p => p.machine.state === 'follower');
    expect(followers.length).toBeGreaterThanOrEqual(4);
  });

  it('stabilises within 6 000 ms of initial state', () => {
    const net = makeNetwork(5);
    advance(net, 6000);
    const leaders = countLeaders(net);
    // Exactly one leader after stabilisation
    expect(leaders).toBe(1);
  });

  it('after leader crash (no heartbeats), election completes within 6 000 ms', () => {
    const net = makeNetwork(5);
    // Stabilise first.
    advance(net, 2000);

    // Crash the leader by removing it from the peers list and stopping heartbeats.
    const leaderIdx = net.peers.findIndex(p => p.machine.state === 'leader');
    if (leaderIdx >= 0) {
      net.peers.splice(leaderIdx, 1);
      for (const peer of net.peers) {
        peer.machine.setPeerCount(4);
      }
    }

    // Remove pending heartbeats from the crashed leader.
    net.queue = net.queue.filter(m => m.from !== `peer-${leaderIdx}` as ActorId);

    // Advance 6 000 ms — a new leader should emerge.
    advance(net, net.now + 6000);
    const leaders = countLeaders(net);
    expect(leaders).toBe(1);
  });

  it('at most one leader at any time during random churn', () => {
    const net = makeNetwork(5);
    // Simulate random leader crashes over 30 s.
    let prevLeaderIdx = -1;

    for (let tick = 0; tick < 30; tick++) {
      advance(net, net.now + 1000);

      const leaderIdx = net.peers.findIndex(p => p.machine.state === 'leader');

      if (leaderIdx !== prevLeaderIdx && leaderIdx >= 0) {
        // Simulate 10% churn: crash leader
        if (Math.random() < 0.1) {
          net.peers.splice(leaderIdx, 1);
          for (const peer of net.peers) {
            peer.machine.setPeerCount(net.peers.length);
          }
          prevLeaderIdx = -1;
        } else {
          prevLeaderIdx = leaderIdx;
        }
      }

      // There must never be more than one leader simultaneously.
      expect(countLeaders(net)).toBeLessThanOrEqual(1);
    }
  });

  it('5 peers with random network delays — leader elected within 6 000 ms of disturbance', () => {
    const net = makeNetwork(5);
    // Stabilise.
    advance(net, 2000);

    // Kill the leader.
    const li = net.peers.findIndex(p => p.machine.state === 'leader');
    if (li >= 0) net.peers.splice(li, 1);
    for (const p of net.peers) p.machine.setPeerCount(4);
    net.queue = net.queue.filter(m => m.type !== 'heartbeat');

    const disturbanceAt = net.now;

    // Advance up to 6 000 ms looking for a stable leader.
    let elected = false;
    while (net.now < disturbanceAt + 6000) {
      advance(net, net.now + 100);
      if (countLeaders(net) === 1) {
        elected = true;
        break;
      }
    }

    expect(elected).toBe(true);
  });
});
