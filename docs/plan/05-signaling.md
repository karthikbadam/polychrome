# 05 — Signaling & WebRTC Mesh

Owned by Track E (`apps/extension/src/signaling/`). Sets up the data
channels that the OT engine and cursor channel ride on.

## Mesh topology

Every peer is connected to every other peer (full mesh) up to a cap of
~10 peers. Beyond that, the leader becomes a star hub (degraded mode,
out of scope for v1 but the abstraction allows it later).

Each pair shares **two** RTCDataChannels:

| Channel | Reliable? | Ordered? | Use |
|---------|-----------|----------|-----|
| `ops`     | yes | yes  | All `Operation` envelopes (the OT log) |
| `cursor`  | no  | no   | Cursor moves, throttled at 30Hz |

(Reliable + ordered is the default for `RTCDataChannel`. The cursor
channel is created with `{ ordered: false, maxRetransmits: 0 }`.)

## Signaling adapter contract

Signaling is the only thing that *can't* be fully P2P; we need a
rendezvous. We hide the choice behind an interface so users can swap
backends in Options.

```ts
// apps/extension/src/signaling/adapter.ts
export interface SignalingAdapter {
  /** Connect to the rendezvous and join `sessionId` as `actorId`. */
  join(sessionId: SessionId, actorId: ActorId): Promise<void>;

  /** Send a signaling message to one peer. */
  sendTo(actorId: ActorId, msg: SignalingMessage): Promise<void>;

  /** Subscribe to incoming signaling messages. */
  onMessage(cb: (from: ActorId, msg: SignalingMessage) => void): Unsubscribe;

  /** Leave the rendezvous; release resources. */
  leave(): Promise<void>;
}

export type SignalingMessage =
  | { type: 'offer';     sdp: string }
  | { type: 'answer';    sdp: string }
  | { type: 'ice';       candidate: RTCIceCandidateInit }
  | { type: 'hello';     proto: number }
  | { type: 'bye';       reason?: string };
```

### Adapters shipped in v1

1. **PeerJS public** (`peerjs-public`) — uses `peerjs.com` free server.
   Default for fastest demo experience.
2. **P2PCF** (`p2pcf-worker`) — bring-your-own-Cloudflare-Worker.
   Recommended for production.
3. **Local LAN** (`mdns-fallback`) — uses `chrome.mdns` if available
   (no current public API for extensions; spike only).

User picks one in Options. Default = `peerjs-public`.

## Mesh manager

```ts
// apps/extension/src/signaling/mesh.ts
export class MeshManager {
  constructor(opts: {
    adapter: SignalingAdapter;
    iceServers: RTCIceServer[];
    onPeerJoin: (actorId: ActorId) => void;
    onPeerLeave: (actorId: ActorId) => void;
    onOpEnvelope: (from: ActorId, env: Envelope) => void;
    onCursor: (from: ActorId, payload: CursorMovePayload) => void;
  });

  start(sessionId: SessionId, actorId: ActorId): Promise<void>;
  stop(): Promise<void>;
  broadcast(env: Envelope): void;
  sendTo(actorId: ActorId, env: Envelope): void;
  sendCursor(payload: CursorMovePayload): void;     // throttled 30Hz
  peers(): ActorId[];
}
```

### Connection lifecycle

1. Local peer joins via adapter; receives existing peer list.
2. For each existing peer, local peer creates an `RTCPeerConnection`,
   creates an offer, sends via signaling.
3. Remote peer answers; ICE candidates exchanged.
4. Once `iceConnectionState === 'connected'`:
   - Open `ops` and `cursor` channels.
   - Send `Envelope { type: 'hello', body: { proto: 1 } }`.
   - Wait for peer's hello.
   - Mark peer as ready; fire `onPeerJoin`.
5. Send `sync_request` (see `06-replay.md`) to backfill missed ops.

### TURN / STUN

Default `iceServers`:
```ts
[
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
]
```

User can add TURN credentials in Options (free tier:
`openrelay.metered.ca`, paid: Cloudflare). Without TURN, peers behind
symmetric NATs cannot connect — show a banner.

## Cursor throttling

Cursor moves are coalesced to 30Hz with `requestAnimationFrame` on the
content script side; only the last position per frame is sent. The
mesh manager additionally drops frames if any datachannel is congested
(`bufferedAmount > 64KB`).

## Reconnection

- If a `peerconnection.iceConnectionState` flips to `disconnected`, wait
  5s for self-heal. If still disconnected, tear down and re-offer once.
- If still failing, fire `onPeerLeave` and surface in the UI.
- Signaling-adapter disconnect triggers exponential backoff reconnect
  (1s, 2s, 4s, 8s, 16s, then 16s thereafter).

## Acceptance for Track E

- [ ] Two unpacked-extension Chrome profiles join the same room and
      establish a working `ops` channel within 3s on localhost.
- [ ] `MeshManager` cleanly tears down on `stop()`: zero leaked
      `RTCPeerConnection` / `RTCDataChannel`.
- [ ] Cursor throttling stays under 30Hz outbound under continuous
      `mousemove` storms.
- [ ] All three adapters implement the same interface and pass the
      same conformance test suite.
- [ ] Peer-leave detection fires within 8s of pulling network cable.
