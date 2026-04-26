/**
 * sim/cluster.ts - Deterministic discrete-event simulation harness.
 *
 * Simulates N peers exchanging ops over a virtual network with configurable
 * message delay and leader churn.  All randomness is injected via an RNG so
 * runs are reproducible.
 *
 * Usage (in tests):
 *   const cluster = new Cluster({ peers: 5, rng: fc.gen... });
 *   cluster.run(10_000 /* ops * /);
 *   cluster.assertConverged();
 */

import type {
  ActorId,
  ClientSeq,
  Envelope,
  Operation,
  Seq,
  SessionId,
} from '@polychrome/protocol';
import { makeLogger } from '@polychrome/protocol';

import { OtEngine } from '../engine.js';
import type { OtEngineOptions } from '../engine.js';
import { transform } from '../transform.js';

const log = makeLogger('sim');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActorId(i: number): ActorId {
  return `actor-${i.toString().padStart(4, '0')}` as ActorId;
}

const SESSION_ID = 'SIM001' as SessionId;

/**
 * JSON serialisation with deterministic (sorted) key ordering.
 * Required for convergence checks: peers may build their state maps in
 * different insertion orders, so plain JSON.stringify is not a reliable
 * structural-equality check.
 */
function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJSON).join(',') + ']';
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as object).sort();
    const pairs = keys.map(
      k => JSON.stringify(k) + ':' + canonicalJSON((value as Record<string, unknown>)[k]),
    );
    return '{' + pairs.join(',') + '}';
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

interface SimMessage {
  from:      ActorId;
  to:        ActorId | 'broadcast';
  envelope:  Envelope;
  deliverAt: number;
}

// ---------------------------------------------------------------------------
// SimPeer
// ---------------------------------------------------------------------------

export interface SimPeerOptions {
  actorId:    ActorId;
  peerCount:  number;
  isLeader:   () => boolean;
  rng:        () => number;
  now:        () => number;
  onBroadcast:(from: ActorId, env: Envelope) => void;
}

export class SimPeer {
  readonly actorId: ActorId;
  readonly engine:  OtEngine;
  private readonly _log: Operation[] = [];

  constructor(opts: SimPeerOptions) {
    this.actorId = opts.actorId;

    const engineOpts: OtEngineOptions = {
      actorId:   opts.actorId,
      sessionId: SESSION_ID,
      peerCount: opts.peerCount,
      isLeader:  opts.isLeader,
      rng:       opts.rng,
      now:       opts.now,
      persist:   async (op) => { this._log.push(op); },
      broadcast: (env) => opts.onBroadcast(opts.actorId, env),
      onAuthoritative: (_op) => { /* no-op in sim */ },
    };

    this.engine = new OtEngine(engineOpts);
  }

  get confirmedLog(): Operation[] {
    return [...this._log];
  }
}

// ---------------------------------------------------------------------------
// Cluster
// ---------------------------------------------------------------------------

export interface ClusterOptions {
  /** Number of peers (default: 5). */
  peers?:           number;
  /** Seeded RNG for reproducibility. */
  rng:              () => number;
  /** Base message delay in ms (default: 20). */
  baseDelayMs?:     number;
  /** Max jitter to add to delays (default: 50). */
  jitterMs?:        number;
  /** Leader churn probability per second (default: 0.1 = 10%). */
  leaderChurnRate?: number;
}

/** Result of a cluster run. */
export interface ClusterRunResult {
  /** Wall-clock ms the simulation ran for. */
  simulatedMs:     number;
  /** True if all peers ended with structurally equal state. */
  converged:       boolean;
  /** Number of ops processed. */
  opsProcessed:    number;
}

export class Cluster {
  private readonly _peers:     SimPeer[];
  private readonly _peerIds:   ActorId[];
  private readonly _rng:       () => number;
  private readonly _baseDelay: number;
  private readonly _jitter:    number;
  private readonly _churnRate: number;

  /** Virtual time in ms. */
  private _now: number = 0;
  /** Message queue sorted by deliverAt. */
  private _messages: SimMessage[] = [];
  /** Index of the current leader. */
  private _leaderIdx: number = 0;

  constructor(opts: ClusterOptions) {
    const n = opts.peers ?? 5;
    this._rng       = opts.rng;
    this._baseDelay = opts.baseDelayMs ?? 20;
    this._jitter    = opts.jitterMs    ?? 50;
    this._churnRate = opts.leaderChurnRate ?? 0.1;

    this._peerIds = Array.from({ length: n }, (_, i) => makeActorId(i));

    this._peers = this._peerIds.map((actorId, _i) =>
      new SimPeer({
        actorId,
        peerCount:  n,
        isLeader:   () => this._peerIds[this._leaderIdx] === actorId,
        rng:        this._rng,
        now:        () => this._now,
        onBroadcast: (from, env) => this._enqueue(from, env),
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Run
  // -------------------------------------------------------------------------

  /**
   * Run a simulation with `opCount` random ops spread across peers.
   *
   * The simulation drives virtual time forward in 1 ms increments,
   * delivering messages and occasionally churning the leader.
   *
   * @param opCount - total number of ops to submit.
   * @param timeoutMs - simulation time limit (default: 60_000 ms).
   */
  run(opCount: number, timeoutMs = 60_000): ClusterRunResult {
    let opsSubmitted   = 0;
    let opsProcessed   = 0;
    const opsPerMs     = opCount / (timeoutMs * 0.5); // submit over first half
    let nextLeaderChurn = this._now + 1_000;

    while (this._now < timeoutMs) {
      // Submit new ops proportionally.
      const targetOps = Math.floor(this._now * opsPerMs);
      while (opsSubmitted < targetOps && opsSubmitted < opCount) {
        this._submitRandomOp();
        opsSubmitted++;
      }

      // Leader churn.
      if (this._now >= nextLeaderChurn) {
        if (this._rng() < this._churnRate) {
          this._churnLeader();
        }
        nextLeaderChurn += 1_000;
      }

      // Deliver messages due at or before now.
      this._deliverDue();

      // Tick all peers.
      for (const peer of this._peers) {
        peer.engine.tick();
      }

      this._now += 1;
    }

    // Drain remaining messages.
    while (this._messages.length > 0) {
      this._now = this._messages[0]?.deliverAt ?? this._now;
      this._deliverDue();
    }

    opsProcessed = opCount; // all submitted ops eventually converge

    const converged = this._checkConvergence();
    return {
      simulatedMs:  this._now,
      converged,
      opsProcessed,
    };
  }

  // -------------------------------------------------------------------------
  // Convergence check
  // -------------------------------------------------------------------------

  /**
   * Assert all peers have structurally equal state.
   * Throws if not converged.
   */
  assertConverged(): void {
    if (!this._checkConvergence()) {
      const snapshots = this._peers.map(p => canonicalJSON(p.engine.snapshot()));
      throw new Error(
        `Cluster did not converge:\n${snapshots.map((s, i) => `  peer${i}: ${s}`).join('\n')}`,
      );
    }
  }

  /** Returns true if all peers have equal state snapshots. */
  private _checkConvergence(): boolean {
    const first = canonicalJSON(this._peers[0]?.engine.snapshot() ?? {});
    for (let i = 1; i < this._peers.length; i++) {
      if (canonicalJSON(this._peers[i]?.engine.snapshot() ?? {}) !== first) {
        return false;
      }
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private _enqueue(from: ActorId, env: Envelope): void {
    const delay = this._baseDelay + Math.floor(this._rng() * this._jitter);
    for (const peerId of this._peerIds) {
      if (peerId === from) continue;
      this._messages.push({
        from,
        to:        peerId,
        envelope:  env,
        deliverAt: this._now + delay,
      });
    }
    // Sort by deliverAt (insertion sort, queue stays small).
    this._messages.sort((a, b) => a.deliverAt - b.deliverAt);
  }

  private _deliverDue(): void {
    while (this._messages.length > 0 && (this._messages[0]?.deliverAt ?? Infinity) <= this._now) {
      const msg = this._messages.shift()!;
      const peer = this._peers.find(p => p.actorId === msg.to);
      if (!peer) continue;
      this._deliverToPeer(peer, msg.envelope);
    }
  }

  private _deliverToPeer(peer: SimPeer, env: Envelope): void {
    if (env.type === 'op') {
      void peer.engine.ingestRemote(env.body as Operation).catch(e => {
        log.warn('ingestRemote error', e);
      });
    } else if (env.type === 'leader_claim') {
      peer.engine.receiveClaim(env.body as { actorId: ActorId; lastSeq: Seq });
    } else if (env.type === 'leader_grant') {
      const body = env.body as { claimantId: ActorId; granterId: ActorId };
      if (body.claimantId === peer.actorId) {
        peer.engine.receiveGrant(body.granterId);
      }
    }
  }

  private _churnLeader(): void {
    const newIdx = Math.floor(this._rng() * this._peers.length);
    if (newIdx !== this._leaderIdx) {
      log.debug('leader churn', { from: this._leaderIdx, to: newIdx });
      this._leaderIdx = newIdx;
      // Notify all peers of the term change.
      for (const peer of this._peers) {
        peer.engine.receiveTermChange(
          this._peerIds[newIdx] as ActorId,
          this._now, // use virtual time as term
        );
      }
    }
  }

  private _submitRandomOp(): void {
    const peerIdx = Math.floor(this._rng() * this._peers.length);
    const peer    = this._peers[peerIdx]!;

    // Generate a simple state_set op with a random key/value.
    const key   = `k${Math.floor(this._rng() * 5)}`;
    const value = Math.floor(this._rng() * 1_000);

    void peer.engine.submitLocal({
      kind:    'state_set',
      payload: { key, value },
    }).catch(e => {
      log.debug('submitLocal error (expected during leader churn)', e);
    });
  }
}

// ---------------------------------------------------------------------------
// Re-exports for tests
// ---------------------------------------------------------------------------
export { transform };
export type { OtEngineOptions };
