/**
 * engine.ts — OtEngine orchestrator.
 *
 * Wires together:
 *   - State (in-memory SharedStateView)
 *   - PendingQueue
 *   - transform / invert
 *   - LeaderStateMachine
 *
 * The engine accepts callbacks and does NOT call IndexedDB or chrome.* directly.
 *
 * Constructor callbacks:
 *   persist(op)         — called once per confirmed op (to write to IndexedDB etc.)
 *   broadcast(env)      — called to send an envelope over the mesh
 *   onAuthoritative(op) — called once per authoritative (seq-assigned) op
 *   isLeader()          — returns true if this actor is currently the leader
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

import { invert } from './invert.js';
import { LeaderStateMachine } from './leader.js';
import type { ClaimMessage, LeaderCallbacks } from './leader.js';
import { PendingQueue } from './queue.js';
import { State } from './state.js';
import { transform } from './transform.js';

const log = makeLogger('ot');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OtEngineOptions {
  actorId:          ActorId;
  sessionId:        SessionId;
  peerCount:        number;
  /** Returns true when this peer is the current leader. */
  isLeader:         () => boolean;
  /** Persist a confirmed op (IndexedDB etc). */
  persist:          (op: Operation) => Promise<void>;
  /** Broadcast an envelope to all peers. */
  broadcast:        (env: Envelope) => void;
  /** Called for every confirmed (seq-assigned) op. */
  onAuthoritative:  (op: Operation) => void;
  /** Injected RNG — do not use Math.random directly. */
  rng?:             () => number;
  /** Injected clock — do not use Date.now directly. */
  now?:             () => number;
}

// ---------------------------------------------------------------------------
// OtEngine
// ---------------------------------------------------------------------------

/**
 * Pure OT engine that coordinates local op submission, leader assignment,
 * and remote op ingestion.
 *
 * State updates and broadcasts are synchronous; persist() is called
 * fire-and-forget so that IndexedDB latency never blocks OT progress.
 */
export class OtEngine {
  private readonly _actorId:   ActorId;
  private readonly _sessionId: SessionId;
  private readonly _state:     State;
  private readonly _queue:     PendingQueue;
  private readonly _pending:   PendingQueue;
  private readonly _opts:      OtEngineOptions;
  private readonly _leader:    LeaderStateMachine;
  private readonly _now:       () => number;

  /** Global seq counter (latest confirmed seq this peer has seen). */
  private _seq: Seq = 0 as Seq;
  /** Per-actor monotonic client seq counter. */
  private _clientSeq: number = 0;
  /** Log of all confirmed ops in order. */
  private readonly _log: Operation[] = [];

  constructor(opts: OtEngineOptions) {
    this._opts      = opts;
    this._actorId   = opts.actorId;
    this._sessionId = opts.sessionId;
    this._now       = opts.now ?? (() => Date.now());
    this._state     = new State();
    this._queue     = new PendingQueue();
    this._pending   = this._queue; // alias

    const leaderCbs: LeaderCallbacks = {
      onStartHeartbeating: () => {
        log.debug('became leader, starting heartbeats');
      },
      onStopHeartbeating: () => {
        log.debug('stepped down, stopping heartbeats');
      },
      onSendClaim: (lastSeq) => {
        opts.broadcast({
          v:    1,
          type: 'leader_claim',
          body: { actorId: this._actorId, lastSeq } satisfies ClaimMessage,
        });
      },
      onSendGrant: (claimantId) => {
        opts.broadcast({
          v:    1,
          type: 'leader_grant',
          body: { claimantId, granterId: this._actorId },
        });
      },
      onLeaderChange: (newLeaderId) => {
        log.info('leader changed', { newLeaderId });
        if (newLeaderId !== undefined && newLeaderId !== this._actorId) {
          // Re-submit any pending ops to the new leader.
          const pending = this._pending.drain();
          for (const entry of pending) {
            this._pending.enqueue(entry);
            this._submitToLeader(entry.op);
          }
        }
      },
    };

    this._leader = new LeaderStateMachine(
      opts.actorId,
      opts.peerCount,
      this._now,
      leaderCbs,
    );
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Advance the leader state machine.  Call this periodically
   * (e.g. every 100 ms) from a setInterval in the SW.
   */
  tick(): void {
    this._leader.tick(this._now(), this._seq);
  }

  /**
   * Submit a local operation.
   * Returns a promise that resolves once the op receives a global seq.
   */
  submitLocal(
    partial: Omit<Operation, 'seq' | 'sessionId' | 'actorId' | 'clientSeq' | 'parentSeq' | 'ts'>,
  ): Promise<Operation> {
    this._clientSeq += 1;
    const op: Operation = {
      ...partial,
      sessionId: this._sessionId,
      seq:       0 as Seq,
      actorId:   this._actorId,
      clientSeq: this._clientSeq as ClientSeq,
      parentSeq: this._seq,
      ts:        this._now(),
    };

    return new Promise<Operation>((resolve, reject) => {
      this._pending.enqueue({
        op,
        parentSeq: this._seq,
        resolve,
        reject,
      });

      if (this._opts.isLeader()) {
        // Leader assigns seq immediately (synchronous path).
        // _applyConfirmed will call entry.resolve(confirmed) for our own ops.
        void this.leaderAssign(op).catch(err => {
          reject(err as Error);
        });
      } else {
        this._submitToLeader(op);
      }
    });
  }

  /**
   * Ingest an operation received from the network (leader-stamped).
   * Returns a resolved Promise for API compatibility; all processing is
   * synchronous so callers need not await this.
   */
  ingestRemote(op: Operation): Promise<void> {
    if (op.seq === 0 as Seq) {
      // This is an unstamped submission to the leader.
      if (this._opts.isLeader()) {
        void this.leaderAssign(op);
      } else {
        log.warn('received unstamped op but not leader; dropping');
      }
      return Promise.resolve();
    }

    // Already stamped — apply through OT.
    this._applyConfirmed(op);
    return Promise.resolve();
  }

  /**
   * Leader-only: assign a global seq to an op and broadcast it.
   * Returns a resolved Promise for API compatibility; all processing is
   * synchronous so callers need not await this.
   */
  leaderAssign(op: Operation): Promise<Operation> {
    if (!this._opts.isLeader()) {
      return Promise.reject(new Error('leaderAssign called on non-leader'));
    }

    this._seq = (this._seq as number + 1) as Seq;
    const confirmed: Operation = { ...op, seq: this._seq };

    this._applyConfirmed(confirmed);

    // Broadcast the confirmed op to all peers.
    this._opts.broadcast({
      v:    1,
      type: 'op',
      body: confirmed,
    });

    return Promise.resolve(confirmed);
  }

  /**
   * Compute the inverse of an op given the current state.
   * (The caller should pass the state *before* the op was applied.)
   */
  invert(op: Operation): Operation {
    return invert(op, this._state);
  }

  /**
   * Transform b against concurrent a (pure, delegates to transform module).
   */
  transform(a: Operation, b: Operation): Operation {
    return transform(a, b);
  }

  /** Current last confirmed seq. */
  lastSeq(): Seq {
    return this._seq;
  }

  /** Read-only snapshot of current state. */
  snapshot(): ReturnType<State['snapshot']> {
    return this._state.snapshot();
  }

  // -------------------------------------------------------------------------
  // Leader state machine inputs
  // -------------------------------------------------------------------------

  receiveHeartbeat(senderId: ActorId, seq: Seq, term: number): void {
    this._leader.receiveHeartbeat(senderId, seq, term);
  }

  receiveClaim(msg: ClaimMessage): void {
    this._leader.receiveClaim(msg, this._seq);
  }

  receiveGrant(granterId: ActorId): void {
    this._leader.receiveGrant(granterId);
  }

  receiveTermChange(newLeaderId: ActorId, term: number): void {
    this._leader.receiveTermChange(newLeaderId, term);
  }

  setPeerCount(n: number): void {
    this._leader.setPeerCount(n);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Apply a confirmed (seq-bearing) op, running OT against pending ops.
   *
   * This method is intentionally synchronous so that broadcasts happen
   * within the same event-loop turn (critical for the deterministic
   * simulation harness and for low-latency production paths).
   * Persistence is fire-and-forget: IndexedDB latency must not block OT.
   */
  private _applyConfirmed(op: Operation): void {
    // Update seq.
    if ((op.seq as number) > (this._seq as number)) {
      this._seq = op.seq;
    }

    // Transform op against any pending ops that have a lower parentSeq.
    // (The pending ops were submitted against an older state.)
    let transformed = op;
    for (const entry of this._pending) {
      if ((entry.parentSeq as number) < (op.seq as number)) {
        // Transform the confirmed op against the pending op.
        transformed = transform(entry.op, transformed);
      }
    }

    // Apply to state.
    this._state.apply(transformed);
    this._log.push(transformed);

    // Persist fire-and-forget: failures do not affect convergence — the
    // authoritative op has already been applied to in-memory state.
    void this._opts.persist(transformed).catch(e => {
      log.warn('persist error', { seq: op.seq, kind: op.kind, err: e });
    });
    this._opts.onAuthoritative(transformed);

    // Resolve matching pending entry (same actor + clientSeq).
    if (op.actorId === this._actorId) {
      const entry = this._pending.findByClientSeq(op.clientSeq);
      if (entry) {
        const drained = this._pending.drain();
        const remaining = drained.filter(e => e.op.clientSeq !== op.clientSeq);
        for (const e of remaining) this._pending.enqueue(e);
        entry.resolve(transformed);
      }
    }

    log.debug('applied confirmed op', { seq: op.seq, kind: op.kind });
  }

  /** Forward an unconfirmed op to the current leader via broadcast. */
  private _submitToLeader(op: Operation): void {
    this._opts.broadcast({
      v:    1,
      type: 'op',
      body: op,
    });
  }
}
