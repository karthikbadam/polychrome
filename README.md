# PolyChrome 2.0

A modern reimplementation of [PolyChrome (Badam & Elmqvist, ITS '14)](https://dl.acm.org/doi/10.1145/2669485.2669518)
as a Chrome MV3 extension with a fully peer-to-peer architecture, plus
an extension-free "kiosk" runtime that powers the hosted demos.

**Live demos:** https://karthikbadam.github.io/polychrome/

## What works today

- Three demos (drawing, scatterplot, choropleth) sync between peers
  in real time over WebRTC. Brushing, axis selection, list updates,
  and cursor presence all replicate. Late joiners see the full
  current state immediately.
- The Chrome MV3 extension injects `window.polychrome` on allowlisted
  pages. Two browsers in the same room see each other's live cursors
  on **any** page the extension matches; on pages that opt in (our
  demos), full state syncs too.
- Per-page op log: every share / list / checkpoint mutation is
  recorded into a shared Yjs array, viewable as a Timeline in the
  side panel with a one-click "Undo last" for the local actor.
- Best-effort site adapter for [Mosaic](https://idl.uw.edu/mosaic/)
  that mirrors brush/filter selections between peers.

## Repository layout

```
apps/
  extension/        Chrome MV3 extension (background SW, content script,
                    MAIN-world bridge, popup, side panel, adapters)
  landing/          GitHub Pages landing page
packages/
  protocol/         canonical Operation schema + codec
  ot-core/          pure OT transform/invert + leader election
  storage/          IndexedDB op log + snapshots + .polychrome.zip
  sdk/              page-side window.polychrome surface
  kiosk/            Yjs+y-webrtc runtime that backs the hosted demos
                    AND the extension's MAIN-world bridge
  replay-player/    Timeline UI component (used by the side panel)
examples/           drawing, scatterplot, choropleth (D3 v7)
docs/plan/          architecture + per-track briefs
legacy/             archived 2014 PolyChrome code
scripts/
  build-gh-pages.sh stages everything for the GH Pages workflow
.github/workflows/
  ci.yml            lint, typecheck, test, build, upload extension artifact
  pages.yml         build + deploy to https://karthikbadam.github.io/polychrome/
```

## Status by track

See [`docs/plan/README.md`](docs/plan/README.md) for the full table.

Built and merged on this branch:

| Track | Notes |
|---|---|
| A scaffold | pnpm + Vite + crxjs + Turborepo + ESLint/Prettier/Vitest |
| B protocol | `@polychrome/protocol` |
| C ot-core | transform/invert/leader/state |
| D storage | IndexedDB op log, snapshots, `.polychrome.zip` import/export |
| E signaling+mesh | peerjs-public, p2pcf-worker, mdns adapters; 30 Hz cursor throttle |
| F sdk | page-side `window.polychrome` (the original SDK surface) |
| G replay-player | `createTimeline()` widget; powers the side-panel History |
| H background SW | identity + room state; runtime port hub for content scripts |
| I content script | reads SW state, hands config to MAIN-world bridge via dataset |
| J page bridge | MAIN-world script that installs `window.polychrome` on the page |
| K side panel | identity, room, peers, History timeline, Undo last |
| N adapters | adapter framework (registry, types) + Mosaic adapter |
| O examples | drawing, scatterplot, choropleth |
| P publish | landing page, build script, GH Actions workflow |

Out-of-plan: **`@polychrome/kiosk`** is a Yjs-over-y-webrtc runtime
shared by the hosted demos and the extension's MAIN-world bridge.
It exposes `createPolyApi(ydoc, self)` with `share()`, `list()`,
`checkpoint()`, `self`, and a `history` surface (op log + undo).

Not yet implemented: L (devtools panel), M (popup polish + options),
Z (end-to-end integration smoke). Per-track briefs live under
`docs/plan/tracks/`.

## Quick start

```bash
pnpm install
pnpm test                                       # ~236 tests
pnpm build                                      # turbo builds every package
pnpm --filter @polychrome/example-drawing dev   # localhost:5173
```

To stage the GH Pages bundle locally:

```bash
PC_PUBLISH_BASE=/polychrome/ bash scripts/build-gh-pages.sh
npx serve gh-pages-out
```

## Hosted demos (no extension needed)

Each demo at `https://karthikbadam.github.io/polychrome/examples/<name>/`
auto-installs `@polychrome/kiosk`, which connects to a y-webrtc room
keyed by the `?room=<id>` URL parameter. Open the URL in two tabs (or
share the "Copy invite link" from the bottom-left banner) and the
demos sync in real time.

The kiosk supports three modes (configurable via `?mode=` URL param):

- `auto` (default) — use the extension if installed, else fall back to kiosk
- `kiosk` — always use the y-webrtc kiosk transport
- `extension` — require the extension; show a "needs extension" badge if absent

### Connection notes

Signaling goes through [Trystero](https://github.com/dmotz/trystero)'s
**nostr** strategy. Peers discover each other via public Nostr relays
(`wss://relay.damus.io`, `wss://nos.lol`, etc.); the data path is
still pure WebRTC.

The bottom-left banner shows:

- **connecting to signaling…** — the provider is starting up.
- **waiting for a peer · relays N/M** — the room is open and N of M
  Nostr relays are connected. If N is 0 your network is blocking the
  relay WebSockets; nothing the page can do until that changes.
- **N peers connected** — WebRTC data channels are established.

Same-browser tabs sync via the in-process `BroadcastChannel` and
never touch the network. Cross-browser / cross-device sync uses the
WebRTC path. Symmetric / carrier-grade NAT setups still need TURN,
which the kiosk does not bundle.

Console logs `[polychrome] trystero room joined: …` and
`[polychrome] peer joined/left: …` so DevTools shows the connection
flow in real time.

## Loading the extension

```bash
pnpm --filter @polychrome/extension build
# chrome://extensions → Developer mode → Load unpacked → apps/extension/dist
```

Click the toolbar icon to open the popup:
- "Start new room" generates a 6-character room code
- "Join" accepts a code from a peer
- The popup also has an "↗" link to open the side panel

The side panel shows your identity, the active room, live peers
(deduplicated by actor across tabs), the History timeline of every
op produced by anyone in the room, and an "Undo last" button that
rolls back your most recent action.

## Allowlisted sites

The extension's manifest matches:

- `karthikbadam.github.io/polychrome/*` (our demos)
- `idl.uw.edu/mosaic/*` and `uwdata.github.io/mosaic/*` (Mosaic adapter)
- Observable, Vega editor, bl.ocks, Tableau Public (live cursors only;
  no site adapter yet)
- `localhost`

On Mosaic pages, the adapter probes for the live coordinator
(`mc`, `mosaic.coordinator`, `vg.coordinator`, `vgplot.coordinator`)
and mirrors each `Selection`'s value through `polychrome.share()`,
so brushes propagate between peers. The adapter is best-effort: if
Mosaic's API drifts it logs a warning and degrades to a no-op
without crashing the bridge.

## Op log + undo

`createPolyApi(ydoc, self)` records every `share().set()`,
`list().insert()`, `list().delete()`, and `checkpoint()` call into a
shared Yjs `Y.Array` at `polychrome:oplog`. Each record carries
enough context for inversion (`prevValue`, `hadPrev`, etc.). The
log is itself a CRDT, so every peer sees every other peer's
history converge automatically and late joiners replay the full log
via the normal initial-sync.

```ts
api.history.all();                         // readonly snapshot
api.history.subscribe(records => …);       // immediate + on append
api.history.undo(record);                  // applies the inverse
api.history.undoLastBy(myActorId);         // walks back skipping checkpoints
```

The side panel's Timeline reads `api.history` and the "Undo last"
button calls `undoLastBy(self.actorId)`. Undo records a forward op,
so undoing an undo is redo (matches `ot-core`'s invert semantics).

## Legacy

Original 2014 PolyChrome (Node proxy + PeerJS signaling) archived at
[`legacy/`](legacy/).
