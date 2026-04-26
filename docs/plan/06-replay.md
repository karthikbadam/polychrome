# 06 - Replay, Snapshots, Undo, Branching

Owned jointly by Track G (replay player), Track D (storage), Track I
(content script), Track K (timeline UI in side panel).

## Three replay modes

| Mode | Description |
|------|-------------|
| **Live** | Default. Ops apply to the live page as they confirm. |
| **Scrub** | User drags timeline. Page is rewound to a snapshot, ops replay forward to scrub position. Live ops continue accumulating in the SW but are NOT dispatched to the page. |
| **Branch** | User chooses "fork from here" at scrub position. New session is created with the prefix log. Live page becomes the branch's live; the original session continues unaffected on other peers. |

## Snapshot strategy

Two snapshot types stored in `snapshots`:

1. **rrweb snapshot** - a full DOM serialization captured by rrweb at
   the chosen seq boundary. Used for visual replay scaffolding.
2. **state snapshot** - JSON of all `state_set`/`list_*` shared state
   keys at the seq boundary. Cheap; always taken alongside rrweb.

Cadence (configurable in Options):
- Every 30 seconds wallclock, OR
- Every 500 confirmed ops, OR
- On explicit `checkpoint` op.

Whichever fires first.

## Replay player

```ts
// packages/replay-player/src/index.ts
export class ReplayPlayer {
  constructor(opts: {
    storage: StorageReader;        // read-only view of op_log + snapshots
    sessionId: SessionId;
    onApply: (op: Operation) => void;
    onSnapshot: (snap: SnapshotRecord) => void;
    onProgress: (seq: Seq, total: Seq) => void;
  });

  /** Seek to seq T: load nearest snapshot, then stream ops up to T. */
  seek(toSeq: Seq, speed?: number): Promise<void>;

  /** Continuous play from current position. */
  play(speed?: number): void;
  pause(): void;
  stop(): void;

  /** Step a single op forward / backward (backward uses inverses). */
  step(direction: 1 | -1): Promise<void>;
}
```

`speed` ∈ {0.25, 0.5, 1, 2, 4, 8} (UI exposes a dropdown). Time between
ops is computed from their `ts` deltas, multiplied by `1/speed`. Cap
inter-op delay at 250ms to avoid dead-air during long pauses; show a
skip-inactivity hint in the timeline.

## Replay → live transition

On scrub:
1. Side panel sends `replay/seek { sessionId, toSeq, speed }` to SW.
2. SW finds nearest rrweb snapshot at `seq <= toSeq`.
3. SW broadcasts `replay/start` to all content scripts on the session.
4. Content script swaps the page DOM into a "replay sandbox" mode:
   - Saves a reference to the live root.
   - Replaces document.body with a fresh `<div id="pc-replay-root">`.
   - Hands the rrweb snapshot to `rrwebPlayer` to render inside.
   - Suppresses live ops from dispatching.
5. SW streams ops from `snapshot.seq + 1` to `toSeq` into rrwebPlayer at
   the chosen speed.
6. On scrub release with "Resume live": SW sends `replay/end`; content
   script destroys the sandbox and re-mounts the live root. Any
   confirmed ops accumulated during scrub are flushed.
7. On scrub release with "Branch from here": see below.

## Branch creation

```ts
// SW handler
async function branchFrom(sessionId: SessionId, atSeq: Seq) {
  const newId = generateSessionId();
  const ops = await storage.getOps(sessionId, 0, atSeq);
  await storage.createSession({ ...originalMeta, sessionId: newId, branchedFrom: { sessionId, atSeq } });
  await storage.appendOps([...ops]);                  // copy log prefix
  // Take a fresh snapshot at atSeq for the new session
  const snap = await storage.nearestSnapshot(sessionId, atSeq, 'rrweb');
  if (snap) await storage.putSnapshot({ ...snap, sessionId: newId });
  // Optionally: announce branch on the original room as a presence ping.
  return newId;
}
```

The branch is local to the creator; they can invite others to it via a
new room code. The original session is unaffected.

## Undo / Redo

- Triggered from side panel ⌘Z / ⌘⇧Z, or from the devtools panel
  per-op "Undo" button.
- Sends `undo/request { sessionId, targetSeq }` to SW.
- SW asks `OtEngine.invert(op, currentState)` to compute the inverse.
- The inverse is submitted as a normal op (`kind: 'undo'`,
  `payload.targetSeq`). It transforms with concurrent ops like
  anything else.
- The receiving content scripts dispatch the inverse via the same
  `executeRemoteOp` path. For `dom_event` undo, the visual result is
  cosmetic only; UI shows a "🩹 undone" marker.
- Redo is implemented as undo of the latest `undo` op.
- A bounded undo stack of 50 most recent op seqs is kept in memory for
  ⌘Z chain handling.

## rrweb integration notes

- We use rrweb only for **DOM mirroring during replay**; we do NOT use
  rrweb's event capture for live ops (that's our content script).
- `rrwebPlayer` runs in an iframe so it can't escape into the live
  page; the iframe is the replay sandbox.
- We persist rrweb event arrays directly (not the full Player) and
  rebuild the player on each seek.

## Acceptance for Track G + replay across tracks

- [ ] Seek to any seq T returns within 1s for sessions with ≤ 50k ops.
- [ ] Scrub forward and backward repeatedly without memory growth.
- [ ] Step backward via inverses leaves shared state identical to a
      fresh replay-from-zero up to that seq.
- [ ] Branch creates an independent session; ops in the branch do not
      bleed into the parent.
- [ ] Undo of a `state_set` restores the previous value precisely.
- [ ] During scrub, live ops continue to confirm in the SW and are
      flushed correctly on resume-live.
