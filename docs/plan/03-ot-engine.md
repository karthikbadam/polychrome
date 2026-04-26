# 03 — OT Engine

Owned by Track C (`packages/ot-core`). Pure functions, no DOM, no
network, no IndexedDB. Easy to unit-test and property-test.

## Goals

1. **Total order** of all logged ops, established by a sequencer-leader.
2. **Convergence** — every peer applying the canonical op stream ends in
   the same logical state.
3. **Inverses** — every persistent op kind has a computable inverse for
   `undo`.
4. **No central server.** Leader is just a peer with a tag; election is
   deterministic and tolerates churn.

## Concepts

- **Local op**: one this peer originated. Submitted with `seq = 0`,
  `parentSeq = lastObservedSeq`.
- **Remote op**: one received from another peer (via leader).
- **Pending op**: a local op that has been broadcast to the leader but
  not yet stamped with a global `seq`. Lives in a queue.
- **Confirmed op**: leader has assigned `seq`; appended to the local log.
- **Inflight window**: ops the local peer has confirmed but other peers
  may not yet know about. Used to compute `parentSeq` consistency.

## Public API

```ts
// packages/ot-core/src/index.ts
export class OtEngine {
  constructor(opts: {
    actorId: ActorId;
    sessionId: SessionId;
    isLeader: () => boolean;
    persist: (op: Operation) => Promise<void>;
    broadcast: (env: Envelope) => void;
    onAuthoritative: (op: Operation) => void;  // called for every confirmed op
  });

  /** Local actor submits an op. Returns once the op has a confirmed seq. */
  submitLocal(partial: Omit<Operation,'seq'|'sessionId'|'actorId'|'clientSeq'|'parentSeq'|'ts'>): Promise<Operation>;

  /** A peer (leader or follower) hands us an op from the wire. */
  ingestRemote(op: Operation): Promise<void>;

  /** Leader-only: assign seq to a follower's submission and broadcast. */
  leaderAssign(op: Operation): Promise<Operation>;

  /** Compute inverse of an op (for undo). */
  invert(op: Operation, atState: SharedStateView): Operation;

  /** Pure function: transform `b` against concurrent `a`. */
  transform(a: Operation, b: Operation): Operation;

  /** Current observed seq. */
  lastSeq(): Seq;
}
```

## Transform table

For each pair of concurrent op kinds (same `parentSeq`), `transform(a, b)`
returns the rewritten `b'` that should be applied after `a`.

| a \ b | dom_event | state_set | list_insert | list_delete | viewport | presence | undo |
|---|---|---|---|---|---|---|---|
| dom_event   | identity | identity | identity | identity | identity | identity | identity |
| state_set   | identity | LWW (loser→noop if same key) | identity | identity | identity | identity | identity |
| list_insert | identity | identity | shift right if a.idx ≤ b.idx | shift left if a.idx < b.idx | identity | identity | identity |
| list_delete | identity | identity | shift left if a.idx ≤ b.idx | shift left or noop if same idx | identity | identity | identity |
| viewport    | identity | identity | identity | identity | LWW per actor | identity | identity |
| presence    | identity | identity | identity | identity | identity | LWW per actor | identity |
| undo        | identity | identity | identity | identity | identity | identity | conflict; later loses |

"Identity" means `b' = b`. The non-trivial transforms are the four
list-OT cases (Jupiter style). `LWW` means the op with higher `seq` wins;
the loser becomes a no-op (`kind` retained but `payload.applied=false`).

### Why this transform set is sound

We rely on **TP1**:
```
apply(transform(a,b), apply(a, s)) ≡ apply(transform(b,a), apply(b, s))
```
Property tests in `packages/ot-core/src/transform.test.ts` enumerate
random pairs and assert TP1 holds for our op set. We do **not** need TP2
because the leader provides total order — concurrent ops are always
transformed in the leader's chosen order, never in two different orders
on different peers.

## Sequencer-leader election

- **Initial leader**: the actor that creates the room is the initial
  leader.
- **Heartbeat**: leader broadcasts `{type:'leader_heartbeat', seq}` on a
  1-second interval.
- **Suspicion**: a peer that misses 3 consecutive heartbeats marks the
  leader as suspect.
- **Claim**: every non-leader peer computes
  `candidateScore = (lastObservedSeq, -actorId)` (higher seq beats
  lower; ties broken by lexicographically smaller actorId). The
  highest-scoring suspect peer broadcasts `leader_claim`.
- **Grant**: peers respond `leader_grant` if the claimant has equal or
  higher `lastObservedSeq` than themselves. On majority (`>= ceil(N/2)`),
  the claimant becomes leader and broadcasts `leader_heartbeat`.
- **Seq continuity**: new leader's first assigned seq is
  `max(allObservedSeqs) + 1`. If two former-leader ops with the same
  candidate `seq` exist, the OT transform on receipt resolves the
  collision (one wins per LWW or list-OT rules).
- **Split brain mitigation**: claimants require strict majority. In a
  2-peer net split, neither side advances state until rejoined. This is
  acceptable for v1 (small mesh, rare splits).

## Undo / Redo

- `undo(targetSeq)`: synthesizes the inverse of the op at `targetSeq`
  given the current `SharedStateView`. The inverse is itself an op (kind
  `undo`, with `payload.targetSeq`) that goes through OT like any other
  op.
- Per-kind inverses:
  - `dom_event` — visual replay only; inverse is "do nothing" but the
    side-panel timeline marks it dimmed.
  - `state_set { key, value }` — inverse is `state_set { key, prevValue }`
    where `prevValue` is read from the snapshot before `targetSeq`.
  - `list_insert { listId, index }` — inverse is `list_delete`.
  - `list_delete { listId, index }` — inverse is `list_insert`
    (value retrieved from snapshot).
  - `presence` / `viewport` / `checkpoint` — inverse is `state_set` to
    prior value, except `checkpoint` cannot be undone (UI guard).
- **Redo**: an `undo` of an `undo`.

## Pending op state machine

```
                     ┌─────────────┐
                     │ submitLocal │
                     └──────┬──────┘
                            ▼
              ┌─────────────────────────┐
              │ pending (no seq yet)    │
              │ • appended to optimistic│
              │   local view            │
              │ • sent to leader        │
              └────────┬────────────────┘
                       │
            leader_grant │ assigns seq
                       ▼
              ┌─────────────────────────┐
              │ confirmed               │
              │ • seq known             │
              │ • persisted             │
              │ • onAuthoritative fires │
              └─────────────────────────┘
```

If the leader changes mid-flight, the pending op is re-sent to the new
leader. The optimistic view tolerates re-orderings via the OT transform
when the confirmed op finally arrives.

## Acceptance for Track C

- [ ] `transform(transform(a,b), c) ≡ transform(transform(a,c), b')` for
      1000 fast-check generated triples (TP1).
- [ ] `apply(invert(op), apply(op, s)) ≡ s` for every op kind across
      1000 random states.
- [ ] Simulation test: 5 peers, 10k random ops, random leader churn
      (10% per second) — all peers converge to identical final
      `SharedStateView` within 5s of last op.
- [ ] No imports from `chrome.*`, `window.*`, or `indexedDB`.
- [ ] 100% statement coverage on `transform.ts` and `invert.ts`.
