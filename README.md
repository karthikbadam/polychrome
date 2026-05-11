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
  pages — its job is to add the same collaboration to **third-party
  visualization sites** that haven't opted in. Our hosted demos
  don't need it (the kiosk runtime ships with them).
- A **d3-brush DOM mirror** adapter watches `<g class="brush">`
  groups on any allowlisted page (Mosaic, Vega-style, bl.ocks,
  Observable, plain d3) and replicates brush selections between
  peers via dispatched mouse events on the brush overlay. No page
  cooperation required.
- Per-page op log: every share / list / checkpoint mutation is
  recorded into a shared Yjs array, viewable as a Timeline in the
  side panel with a one-click "Undo last" for the local actor.

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
| N adapters | adapter registry + d3-brush DOM mirror (covers Mosaic, vgplot, bl.ocks, plain d3 — any page rendering a `<g class="brush">`) |
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
pnpm test                                       # ~265 tests
pnpm build                                      # turbo builds every package
pnpm --filter @polychrome/example-drawing dev   # localhost:5173
```

`pnpm <demo> dev` runs **only that demo** on its own Vite port. The
landing page's demo cards link with relative paths (`./examples/<x>/`)
so they only resolve when every demo is mounted under one origin —
which the dev servers don't do.

To exercise the full hosted-demo flow locally (landing + all four
demos under one origin, just like production):

```bash
pnpm preview         # builds gh-pages-out/ and serves it on :5180
```

This is the right local target for testing cross-demo navigation,
the kiosk transport, and the room-share invite link.

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

## Allowlisted sites and the d3-brush adapter

The extension's value proposition is bringing collaboration to
**pages we don't own**. Our hosted demos already use the kiosk
runtime, so the extension is a no-op on the demo origin (it skips
itself to avoid double-mirroring).

The manifest matches:

- `idl.uw.edu/mosaic/*` and `uwdata.github.io/mosaic/*` (Mosaic
  examples)
- `observablehq.com/*` and `*.observableusercontent.com/*`
- `vega.github.io/editor/*`
- `bl.ocks.org/*`
- `public.tableau.com/*`
- `karthikbadam.github.io/polychrome/*` (the cursors layer is fine,
  the d3-brush adapter explicitly skips this origin)
- `localhost` (with the demo dev ports excluded)

### How sync works on third-party pages

Live cursors run everywhere — the bridge captures pointer events
itself and renders peer arrows over the page. No page cooperation
needed.

Beyond cursors, modern viz libraries like Mosaic keep their
`Coordinator` / `Selection` objects inside ESM module closures we
can't reach from a `<script>`. So instead of trying to hook the
library, we **mirror the DOM that any d3-brush-backed page
produces**:

```
<g class="brush">
  <rect class="overlay" .../>
  <rect class="selection" x y width height [display:none when empty]/>
  <rect class="handle handle--n" />
  ...
</g>
```

The adapter (`apps/extension/src/main-world/adapters/d3-brush.ts`):

1. Discovers every `g.brush` in document order. A `MutationObserver`
   on `document.body` picks up brushes that appear async (Mosaic
   renders plots after data load).
2. Watches each brush's selection rect for attribute changes; when
   the local user drags, it broadcasts
   `{ sel: [x,y,w,h] | null, ow, oh }` via
   `polychrome.share('brush.<index>')`. Overlay dimensions travel
   with the snapshot so peers with different viewport sizes
   re-scale correctly.
3. On a remote update, dispatches `mousedown / mousemove /
   mousemove / mouseup` on the brush overlay at the recorded
   extent's corners. d3-brush's state machine listens for those on
   the overlay, so it drives its `'brush'`/`'end'` events normally
   and the page's downstream selection / re-render logic runs as
   if the user had dragged.

Because every d3-driven viz page (Mosaic, vgplot, bl.ocks examples,
plain d3) renders brushes the same way, this single adapter covers
the whole d3 ecosystem. Pages that don't use a d3 brush (Tableau
Public, Observable runtimes that paint their own selection UI) get
live cursors only — they need their own adapter to sync state.

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
