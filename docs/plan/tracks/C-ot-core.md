# Track C - OT Core

**Wave**: 3 (parallel with D, E, F, G)
**Depends on**: A, B
**Blocks**: H

## Goal

Implement `@polychrome/ot-core` - the pure-logic Operational
Transformation engine specified in `docs/plan/03-ot-engine.md`.

## Files I own (exclusive)

- `packages/ot-core/package.json` (replace stub)
- `packages/ot-core/src/engine.ts`
- `packages/ot-core/src/transform.ts`
- `packages/ot-core/src/invert.ts`
- `packages/ot-core/src/state.ts` - in-memory `SharedStateView`
- `packages/ot-core/src/leader.ts` - election state machine
- `packages/ot-core/src/queue.ts` - pending op queue
- `packages/ot-core/src/index.ts` (re-exports)
- `packages/ot-core/src/**/*.test.ts`
- `packages/ot-core/src/sim/` - simulation harness for property tests

## Spec

Implement everything in `docs/plan/03-ot-engine.md`:
- `OtEngine` class with the public API listed there
- `transform(a, b)` per the transform table
- `invert(op, state)` per the inverse table
- Sequencer-leader election state machine
- Pending op state machine

## Implementation order

1. `state.ts` - `SharedStateView` data structure: shared keys (a Map)
   + shared lists (a Map of key → array). Plus `apply(op): void` and
   `clone(): SharedStateView` and `snapshot(): JsonValue`.
2. `transform.ts` - pure functions; per-pair table from the spec.
   Include exhaustive switch with `assertNever` default.
3. `invert.ts` - pure function returning a new `Operation` with
   `kind: 'undo'` and the appropriate payload to restore state.
4. `queue.ts` - pending op queue: enqueue, dequeue, peek; tracks
   `parentSeq` per pending op.
5. `leader.ts` - election state machine:
   - States: `follower`, `candidate`, `leader`.
   - Inputs: `heartbeat_received`, `heartbeat_timeout`, `claim_received`,
     `grant_received`, `term_change`.
   - Outputs: `start_heartbeating`, `stop_heartbeating`, `send_claim`,
     `send_grant`.
   - Heartbeat interval: 1s. Suspect after 3 missed (3s).
6. `engine.ts` - orchestrator that wires the above pieces against the
   constructor-supplied callbacks (`persist`, `broadcast`,
   `onAuthoritative`, `isLeader`).

## Tests

- `transform.test.ts` - fast-check property tests: TP1 over 1000
  random op pairs.
- `invert.test.ts` - for every op kind, generate random states, apply
  op, invert, apply inverse, assert state == original (1000 cases).
- `leader.test.ts` - discrete-event simulation: 5 peers, random
  network delays, random leader churn (10%/s), assert deterministic
  election within 6s of any disturbance.
- `sim/cluster.test.ts` - full simulation: 5 peers, 10k random ops,
  random partitions/heals, assert convergence within 5s of last op.

## Acceptance

Per `docs/plan/03-ot-engine.md` acceptance:

- [ ] TP1 holds for all sampled pairs.
- [ ] All inverses round-trip (`apply(invert(op)) ∘ apply(op) = id`).
- [ ] 5-peer simulation converges with 10% leader churn.
- [ ] No imports from `chrome.*`, DOM, or `indexedDB`.
- [ ] 100% statement coverage on `transform.ts` and `invert.ts`.
- [ ] No `Math.random` in core logic - use injected RNG so simulations
      are reproducible.

## Notes for the agent

- `transform` and `invert` MUST be deterministic and pure.
- The engine accepts callbacks; it does NOT call IndexedDB or
  `chrome.*` directly.
- Add JSDoc at every public function; the side-panel devtools panel
  (Track L) introspects function names.
