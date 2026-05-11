# Track G - Replay Player

**Wave**: 3 (parallel with C, D, E, F)
**Depends on**: A, B
**Blocks**: I (content script needs the player to render replay sandbox)

## Goal

Implement `@polychrome/replay-player` - a framework-agnostic player
that, given a session's op log + snapshots (via a `StorageReader`
interface), produces a deterministic stream of dispatch instructions.

The player itself does NOT touch the DOM. It hands events to a callback
that the content script (Track I) routes through `executeRemoteOp`.
This separation makes the player unit-testable in Node.

## Files I own (exclusive)

- `packages/replay-player/package.json` (replace stub)
- `packages/replay-player/src/index.ts`
- `packages/replay-player/src/player.ts`
- `packages/replay-player/src/storage-reader.ts` - interface only
- `packages/replay-player/src/scheduler.ts` - speed / pause / step
- `packages/replay-player/src/rrweb-adapter.ts` - wraps rrweb player calls
- `packages/replay-player/src/__tests__/**`

## Dependencies to add

- `@rrweb/replay` (or `rrweb-player`)

## Public API

Mirrors `docs/plan/06-replay.md`:

```ts
export interface StorageReader {
  getOps(sessionId: SessionId, fromSeq: Seq, toSeq: Seq): AsyncIterable<Operation>;
  nearestSnapshot(sessionId: SessionId, beforeSeq: Seq, type: 'rrweb'|'state'): Promise<SnapshotRecord | null>;
  lastSeq(sessionId: SessionId): Promise<Seq>;
}

export interface ReplayCallbacks {
  onApply(op: Operation): void;
  onSnapshot(snap: SnapshotRecord): void;
  onProgress(seq: Seq, total: Seq): void;
  onState(state: 'idle' | 'seeking' | 'playing' | 'paused' | 'stopped'): void;
}

export class ReplayPlayer {
  constructor(opts: { storage: StorageReader; sessionId: SessionId; cb: ReplayCallbacks });
  seek(toSeq: Seq, speed?: Speed): Promise<void>;
  play(speed?: Speed): void;
  pause(): void;
  stop(): void;
  step(direction: 1 | -1): Promise<void>;
}

export type Speed = 0.25 | 0.5 | 1 | 2 | 4 | 8;
```

## Behavior

1. `seek(T)`:
   - Find nearest rrweb snapshot at `seq <= T`.
   - Fire `onSnapshot(snap)`.
   - Stream ops `(snap.seq + 1) .. T` via `onApply` as fast as
     possible (no inter-op delay during seek).
   - Fire `onProgress` periodically.
2. `play(speed)`:
   - Resume from current position.
   - Stream ops via `onApply`, sleeping by `(op[n+1].ts - op[n].ts) /
     speed`, capped at 250ms.
   - Stops at end of log; fires `onState('stopped')`.
3. `step(+1)`:
   - Apply next op via `onApply`.
4. `step(-1)`:
   - Compute inverse via `OtEngine.invert` (instance injected by the
     consumer; player accepts an `invert` function in its
     constructor); apply via `onApply`.

## rrweb adapter

A small helper wrapping `@rrweb/replay`'s `Replayer`:

```ts
class RrwebSandbox {
  constructor(rootEl: HTMLElement);
  loadSnapshot(events: unknown[]): void;
  step(timestampMs: number): void;
  destroy(): void;
}
```

Track I uses this from inside the content script after creating the
sandbox iframe.

## Tests

- Synthetic op log (1k ops, 10 snapshots): seek to any seq returns
  consistent state via `onApply` callbacks.
- Speed control: `play(2)` halves wall time vs `play(1)` (within 10%).
- `pause()` mid-play stops further `onApply`; `play()` resumes.
- `step(-1)` after `step(+1)` returns to identical state via inverse.

## Acceptance

Per `docs/plan/06-replay.md`:

- [ ] Seek returns within 1s for 50k-op session.
- [ ] No memory growth across repeated forward/backward scrubs (run
      10k seek cycles in test).
- [ ] No DOM imports; uses only `setTimeout` / `Promise` / typed
      arrays.
- [ ] `RrwebSandbox` wraps rrweb cleanly; rrweb errors don't crash
      the player.

## Notes for the agent

- Player is consumed by both the content script (in-page replay) AND
  the side panel (when scrubbing without a tab open - show "preview"
  in a panel iframe). Keep DOM-touching code in `RrwebSandbox` only.
- Inject an RNG / clock if you need them, so tests are deterministic.
