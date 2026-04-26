# Track E — Signaling & WebRTC Mesh

**Wave**: 3 (parallel with C, D, F, G)
**Depends on**: A, B
**Blocks**: H

## Goal

Implement the WebRTC mesh and pluggable signaling layer specified in
`docs/plan/05-signaling.md`.

## Files I own (exclusive)

- `apps/extension/src/signaling/index.ts`
- `apps/extension/src/signaling/adapter.ts` — `SignalingAdapter` interface
- `apps/extension/src/signaling/adapters/peerjs-public.ts`
- `apps/extension/src/signaling/adapters/p2pcf-worker.ts`
- `apps/extension/src/signaling/adapters/conformance.ts` — shared test suite
- `apps/extension/src/signaling/mesh.ts` — `MeshManager`
- `apps/extension/src/signaling/peer-connection.ts` — single-peer wrapper
- `apps/extension/src/signaling/throttle.ts` — cursor coalescer
- `apps/extension/src/signaling/__tests__/**`

## Dependencies to add

- `peerjs` (only used inside the peerjs-public adapter; no global
  dependency on PeerJS in the rest of the codebase)

## Spec

Implement everything in `docs/plan/05-signaling.md`. Key points:

- Mesh of at most 10 peers; degrade to "leader-as-hub" star above that
  (toggle in `MeshManager` but only the mesh path is wired in v1).
- Two channels per peer: `ops` (reliable, ordered) and `cursor`
  (unreliable, unordered, no retransmits).
- `iceServers` configurable; defaults are the two STUN servers in the
  spec.
- Cursor coalescing at 30Hz via `requestAnimationFrame` / fallback
  `setTimeout(33)` in service workers (no rAF in SW; use 33ms timer).

## Implementation order

1. `adapter.ts` — interface + `SignalingMessage` (re-export from
   protocol).
2. `adapters/peerjs-public.ts` — wraps PeerJS DataConnections to
   carry our SignalingMessage envelope. Uses `new Peer(actorId, ...)`
   with the public PeerJS server.
3. `adapters/p2pcf-worker.ts` — minimal HTTP/WebSocket client for a
   bring-your-own Cloudflare Worker (URL set in Options). Stub may
   throw "not configured" until the user provides URL.
4. `peer-connection.ts` — wraps an `RTCPeerConnection` + two channels.
   Handles offer/answer/ice exchange via the adapter; emits
   `onOpEnvelope` and `onCursor`.
5. `mesh.ts` — joins the room via adapter, creates a
   `PeerConnection` per remote actor, exposes `broadcast`,
   `sendCursor`, peer events.
6. `throttle.ts` — small utility used by `mesh.ts` for cursor
   coalescing.

## Tests

- Adapter conformance suite: every adapter passes the same set of
  tests (uses a mock signaling channel for unit tests).
- `MeshManager.start/stop` lifecycle leaves zero open connections
  (track via `RTCPeerConnection` mock).
- E2E (Playwright in Track Z): two profiles, same room, verify ops
  channel works in < 3s.
- Cursor throttle stays at ≤ 30Hz under burst input.

## Acceptance

Per `docs/plan/05-signaling.md`:

- [ ] Two unpacked-extension Chrome profiles join the same room and
      establish a working `ops` channel within 3s on localhost.
- [ ] `MeshManager` cleanly tears down on `stop()`.
- [ ] Cursor throttling stays under 30Hz outbound.
- [ ] All adapters implement the same interface and pass the
      conformance suite.
- [ ] Peer-leave detection fires within 8s of network loss.

## Notes for the agent

- Service workers in MV3 lose `RTCPeerConnection` access in some
  conditions. Spike: confirm RTCPeerConnection works in MV3 SW. If not,
  move the mesh to an offscreen document (created on demand by the SW)
  and route messages through it. Document the choice in
  `apps/extension/src/signaling/README.md`.
- Do not import from `apps/extension/src/storage/`; mesh is pure
  network. The SW (Track H) wires storage and mesh together.
- All ICE/SDP serialization goes through `JSON.stringify`; do not
  pre-parse.
