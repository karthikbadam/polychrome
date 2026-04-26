/**
 * leader.ts - Sequencer-leader election state machine.
 *
 * States: follower | candidate | leader
 *
 * Inputs (events fed via tick() and receive()):
 *   heartbeat_received  - a leader_heartbeat arrived
 *   heartbeat_timeout   - clock tick with no heartbeat for 3s
 *   claim_received      - a peer broadcasts leader_claim
 *   grant_received      - a peer grants this peer's claim
 *   term_change         - forced term update (e.g. new leader announced)
 *
 * Outputs (callbacks supplied in constructor):
 *   onStartHeartbeating - called when we become leader; emit heartbeats at 1s
 *   onStopHeartbeating  - called when we cease being leader
 *   onSendClaim         - broadcast leader_claim message
 *   onSendGrant         - reply with leader_grant to a claimant
 *   onLeaderChange      - notify engine that the leader changed
 *
 * Heartbeat interval: 1 000 ms.  Suspect after 3 consecutive misses (3 000 ms).
 */

import type { ActorId, Seq } from '@polychrome/protocol';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LeaderState = 'follower' | 'candidate' | 'leader';

export interface LeaderCallbacks {
  /** Start emitting heartbeats (1 s interval). */
  onStartHeartbeating(): void;
  /** Stop emitting heartbeats. */
  onStopHeartbeating(): void;
  /**
   * Broadcast a leader_claim message.
   * @param lastSeq - this peer's last observed seq (used as candidateScore)
   */
  onSendClaim(lastSeq: Seq): void;
  /**
   * Reply leader_grant to a claimant.
   * @param claimantId - the actor that sent the claim
   */
  onSendGrant(claimantId: ActorId): void;
  /**
   * Notify that leadership has changed.
   * @param newLeaderId - undefined if no clear leader (in election)
   */
  onLeaderChange(newLeaderId: ActorId | undefined): void;
}

export interface ClaimMessage {
  actorId:  ActorId;
  lastSeq:  Seq;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 1_000;
const SUSPECT_THRESHOLD     = 3; // base misses before suspecting

/**
 * Per-actor jitter (in additional missed intervals).  Range: 0..2.
 * Combined with SUSPECT_THRESHOLD this gives 3..5 missed heartbeats before
 * an election starts.  The jitter is deterministic in actorId so the same
 * peer always elects at the same offset, ensuring tests are reproducible.
 *
 * Without jitter, simultaneous heartbeat-loss across N peers makes them
 * all candidates at the same instant.  They all vote for themselves and
 * refuse to grant each other (one-vote-per-term rule), so the election
 * deadlocks.  Staggering candidates fixes this without sacrificing the
 * safety property "at most one leader per term".
 */
function _actorJitter(actorId: ActorId): number {
  let h = 0;
  for (let i = 0; i < (actorId as string).length; i++) {
    h = (h * 31 + (actorId as string).charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 3;
}

// ---------------------------------------------------------------------------
// LeaderStateMachine
// ---------------------------------------------------------------------------

/**
 * Leader election state machine.
 *
 * Call tick(now) periodically (e.g. every 100 ms) to drive timeout logic.
 * Call the receive* methods when corresponding network messages arrive.
 */
export class LeaderStateMachine {
  private _state:             LeaderState = 'follower';
  private _currentLeaderId:   ActorId | undefined;
  private _term:              number = 0;
  private _lastHeartbeatTime: number = 0;
  private _missCount:         number = 0;
  /** Grants received for the current election round. */
  private _grantsReceived:    Set<ActorId> = new Set();
  /** Total number of peers in the session (including self). */
  private _peerCount:         number;
  /** Per-actor election jitter (0..2 extra missed heartbeats). */
  private readonly _jitter:   number;
  /** Pending claim to track timeout. */
  private _claimStartTime:    number | undefined;
  /**
   * Term for which this peer has already cast a vote (granted a claim).
   * Each peer votes at most once per term to prevent split-brain.
   * A candidate votes for itself when starting an election.
   */
  private _votedForTerm:      number = -1;

  readonly actorId:   ActorId;
  private readonly cb: LeaderCallbacks;
  private readonly getNow: () => number;

  /**
   * @param actorId   - This peer's actor id.
   * @param peerCount - Total peers (including self). Used for majority calc.
   * @param now       - Injected clock (ms). Default: Date.now.
   * @param callbacks - Outcome callbacks.
   */
  constructor(
    actorId: ActorId,
    peerCount: number,
    now: () => number,
    callbacks: LeaderCallbacks,
  ) {
    this.actorId    = actorId;
    this._peerCount = peerCount;
    this.getNow     = now;
    this.cb         = callbacks;
    this._jitter    = _actorJitter(actorId);
    this._lastHeartbeatTime = now();
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  get state(): LeaderState {
    return this._state;
  }

  get currentLeaderId(): ActorId | undefined {
    return this._currentLeaderId;
  }

  get term(): number {
    return this._term;
  }

  /** Update the number of peers (called when peers join/leave). */
  setPeerCount(n: number): void {
    this._peerCount = n;
  }

  /**
   * Immediately transition to leader state (used for the initial room creator
   * or for deterministic sim bootstrap).  Fires onStartHeartbeating.
   */
  bootAsLeader(): void {
    this._becomeLeader();
  }

  // -------------------------------------------------------------------------
  // Input: time advances
  // -------------------------------------------------------------------------

  /**
   * Advance the clock.  Call this at least once per 200 ms.
   * @param now - current timestamp (ms).
   * @param lastObservedSeq - this peer's last confirmed seq.
   */
  tick(now: number, lastObservedSeq: Seq): void {
    if (this._state === 'leader') {
      // Leaders don't watch heartbeats from themselves.
      return;
    }

    const elapsed = now - this._lastHeartbeatTime;
    const intervals = Math.floor(elapsed / HEARTBEAT_INTERVAL_MS);

    if (intervals > this._missCount) {
      this._missCount = intervals;
    }

    if (this._missCount >= SUSPECT_THRESHOLD + this._jitter && this._state === 'follower') {
      this._startElection(now, lastObservedSeq);
    }

    // Candidate timeout: if we haven't won in 2× heartbeat interval, retry.
    if (
      this._state === 'candidate' &&
      this._claimStartTime !== undefined &&
      now - this._claimStartTime > HEARTBEAT_INTERVAL_MS * 2
    ) {
      this._startElection(now, lastObservedSeq);
    }
  }

  // -------------------------------------------------------------------------
  // Input: network messages
  // -------------------------------------------------------------------------

  /** Called when a leader_heartbeat arrives. */
  receiveHeartbeat(senderId: ActorId, seq: Seq, term: number): void {
    const now = this.getNow();
    if (term < this._term) return; // stale term - ignore

    if (term > this._term) {
      this._term = term;
      this._stepDown(senderId);
      return;
    }

    // Same term
    this._lastHeartbeatTime = now;
    this._missCount         = 0;
    this._currentLeaderId   = senderId;
    void seq; // used for parentSeq reconciliation elsewhere

    if (this._state !== 'follower') {
      this._stepDown(senderId);
    }
  }

  /**
   * Called when another peer broadcasts a leader_claim.
   *
   * Grants only if:
   *   1. We are not the current leader (leaders are alive; no election needed).
   *   2. The claimant scores at least as well as us:
   *      score = (lastSeq DESC, actorId ASC) - the spec's candidateScore.
   *   3. We have not already voted in this term (one-vote-per-term rule).
   *
   * @param msg         - the claim message
   * @param myLastSeq   - this peer's last confirmed seq (for comparison)
   */
  receiveClaim(msg: ClaimMessage, myLastSeq: Seq): void {
    // Active leaders do not grant claims - they are alive and healthy.
    if (this._state === 'leader') return;

    // Evaluate candidateScore: higher lastSeq wins; ties broken by
    // lexicographically smaller actorId (spec: -actorId in score).
    const claimantSeq = msg.lastSeq as number;
    const mySeq       = myLastSeq as number;

    const claimantWins =
      claimantSeq > mySeq ||
      (claimantSeq === mySeq && msg.actorId < this.actorId);

    if (!claimantWins) return;

    // One-vote-per-term: prevent split-brain when multiple peers claim
    // simultaneously.  A candidate votes for itself in _startElection.
    // Per-actor election jitter (see _suspectThreshold) ensures candidates
    // emerge at staggered times, so the one-vote rule converges naturally.
    if (this._term <= this._votedForTerm) return;

    this._votedForTerm = this._term;
    this.cb.onSendGrant(msg.actorId);
  }

  /**
   * Called when a peer sends us a leader_grant in response to our claim.
   * @param granterId - actor id of the granting peer
   */
  receiveGrant(granterId: ActorId): void {
    if (this._state !== 'candidate') return;
    this._grantsReceived.add(granterId);
    // Include self-grant (we always vote for ourselves).
    const majority = Math.ceil(this._peerCount / 2);
    if (this._grantsReceived.size + 1 >= majority) {
      this._becomeLeader();
    }
  }

  /**
   * Called when a term-change message is received (explicit leadership transfer).
   */
  receiveTermChange(newLeaderId: ActorId, term: number): void {
    if (term <= this._term) return;
    this._term = term;
    this._stepDown(newLeaderId);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _startElection(now: number, lastObservedSeq: Seq): void {
    this._state           = 'candidate';
    this._term            += 1;
    this._grantsReceived   = new Set();
    this._claimStartTime   = now;
    this._currentLeaderId  = undefined;
    // Vote for ourselves - prevents granting other candidates in this term.
    this._votedForTerm     = this._term;
    this.cb.onLeaderChange(undefined);
    this.cb.onSendClaim(lastObservedSeq);
  }

  private _becomeLeader(): void {
    this._state           = 'leader';
    this._currentLeaderId = this.actorId;
    this._claimStartTime  = undefined;
    this.cb.onLeaderChange(this.actorId);
    this.cb.onStartHeartbeating();
  }

  private _stepDown(newLeaderId: ActorId): void {
    const wasLeader = this._state === 'leader';
    this._state           = 'follower';
    this._currentLeaderId = newLeaderId;
    this._claimStartTime  = undefined;
    this._grantsReceived  = new Set();

    if (wasLeader) {
      this.cb.onStopHeartbeating();
    }
    this.cb.onLeaderChange(newLeaderId);
  }
}
