# 02 - Protocol (the canonical contract)

This file defines the wire format and types every other component depends
on. **Do not change without coordinating across tracks.** All types live
in `packages/protocol/src/types.ts` and are owned by Track B.

## Identifiers

```ts
type SessionId = string;   // 6-char base32, e.g. "G7K2QM"
type ActorId   = string;   // UUIDv4, stable per browser profile
type Seq       = number;   // monotonic int, server-assigned by leader
type ClientSeq = number;   // monotonic int, per-actor local count
```

## The Operation

```ts
interface Operation {
  sessionId:   SessionId;
  seq:         Seq;          // 0 until leader assigns; canonical after
  clientSeq:   ClientSeq;    // assigned by originating peer
  actorId:     ActorId;
  ts:          number;       // ms since epoch, originator's clock
  parentSeq:   Seq;          // last seq the originator had observed
  kind:        OpKind;
  target?:     TargetRef;    // present for dom_event ops
  payload:     OpPayload;    // discriminated by `kind`
  sig?:        string;       // optional HMAC of (sessionId|seq|payload)
}
```

### `OpKind` (closed set; do not extend without RFC)

| kind | purpose | transform | persisted | replayable |
|------|---------|-----------|-----------|------------|
| `dom_event`    | Captured user input event | identity | yes | yes |
| `state_set`    | Set value on shared key | LWW by seq | yes | yes |
| `list_insert`  | Insert into shared list | Jupiter list-OT | yes | yes |
| `list_delete`  | Delete from shared list | Jupiter list-OT | yes | yes |
| `cursor_move`  | Pointer position broadcast | n/a | **no** | no |
| `presence`     | Display name / color / status | LWW per actor | yes | partial |
| `viewport`     | Tile config for cross-device | LWW per actor | yes | yes |
| `checkpoint`   | Named bookmark in timeline | identity | yes | yes |
| `undo`         | Inverse of a prior op | identity | yes | yes |
| `kick`         | Leader removes an actor | LWW | yes | no |

`cursor_move` is the only op that bypasses OT and the log. It travels on
a separate datachannel for low-latency presence and is dropped if not
delivered. Everything else goes through the log.

### `TargetRef` - addressing a DOM element across peers

```ts
interface TargetRef {
  selector: string;         // CSS selector, prefer ID-based
  xpath?:   string;         // fallback when selector is ambiguous
  rect?:    { x:number; y:number; w:number; h:number };  // viewport-relative
  text?:    string;         // textContent prefix, last-resort disambiguator
  frameId?: number;         // chrome frame id when not top frame
}
```

Target resolution on the receiver tries: (1) `selector` → if unique,
done; (2) `xpath`; (3) `elementFromPoint(rect.x+rect.w/2, ...)` after
scaling; (4) `text` prefix match within nearest container. If all fail,
the op is dropped and logged to the devtools panel.

### `OpPayload` - per-kind shape

```ts
type OpPayload =
  | DomEventPayload
  | StateSetPayload
  | ListInsertPayload
  | ListDeletePayload
  | CursorMovePayload
  | PresencePayload
  | ViewportPayload
  | CheckpointPayload
  | UndoPayload
  | KickPayload;

interface DomEventPayload {
  type:     'click'|'mousedown'|'mousemove'|'mouseup'|'touchstart'|'touchmove'|'touchend'|'keydown'|'keyup'|'input'|'scroll'|'wheel';
  // Normalized to ideal coords (1920x1080); receiver scales back.
  x?:       number;
  y?:       number;
  button?:  number;
  buttons?: number;
  key?:     string;
  code?:    string;
  modifiers?: { alt:boolean; ctrl:boolean; meta:boolean; shift:boolean };
  value?:   string;     // for input events
  deltaY?:  number;     // for wheel
  scrollX?: number;
  scrollY?: number;
}

interface StateSetPayload { key: string; value: unknown; }
interface ListInsertPayload { listId: string; index: number; value: unknown; }
interface ListDeletePayload { listId: string; index: number; }
interface CursorMovePayload { x: number; y: number; }
interface PresencePayload   { name?: string; color?: string; idle?: boolean; }
interface ViewportPayload   { tileIndex: number; tileTotal: number; layout: 'h'|'v'|'2x2'|'2x3'|'3x2'; }
interface CheckpointPayload { label: string; }
interface UndoPayload       { targetSeq: Seq; }
interface KickPayload       { actorId: ActorId; reason?: string; }
```

## Coordinate normalization

All `x, y` in `DomEventPayload` and `CursorMovePayload` are in the **ideal
viewport** of `1920 × 1080`. The capture side scales:

```
ideal_x = native_x * 1920 / window.innerWidth
ideal_y = native_y * 1080 / window.innerHeight
```

The dispatch side reverses the scale before calling
`elementFromPoint`. Constants live in `packages/protocol/src/coords.ts`.

## Wire encoding

- **Mesh transport**: JSON over WebRTC datachannel. `JSON.stringify(op)`.
  v1 does not need binary; profile if hot.
- **IndexedDB**: structured-clone of the `Operation` object, keyed by
  `[sessionId, seq]`.
- **Export ZIP**: `meta.json` + `ops.jsonl` (one op per line) +
  `snapshots/<seq>.rrweb.json`.

## Versioning

```ts
const PROTOCOL_VERSION = 1;
```

Every op exchanged on the wire is wrapped in an envelope:

```ts
interface Envelope {
  v:    1;          // protocol version
  type: 'op'|'op_batch'|'cursor'|'sync_request'|'sync_response'|'leader_claim'|'leader_grant';
  body: unknown;
}
```

A peer announcing protocol version mismatch gets a polite refusal
broadcast (`type: 'incompatible'`) and is dropped.

## Acceptance for Track B

- [ ] All types compile under `tsc --strict`.
- [ ] `encode(op)` and `decode(buf)` round-trip every `OpKind`.
- [ ] `coords.toIdeal(x, y, w, h)` and `coords.fromIdeal(...)` are
      inverses to within 1px.
- [ ] `targetRef.from(element)` produces a `TargetRef` that
      `targetRef.resolve(ref)` recovers exactly on the same DOM.
- [ ] Property test: `JSON.parse(JSON.stringify(op))` deep-equals `op`
      for 1000 random ops.
