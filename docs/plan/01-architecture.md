# 01 — System Architecture

## Process boundaries

A PolyChrome 2.0 session involves **N peers**, where each peer is a Chrome
profile running the extension. There is no central application server.

```
┌─────────────────── Peer (one Chrome profile) ───────────────────┐
│                                                                  │
│  ┌───────────────────── MV3 Extension ──────────────────────┐   │
│  │                                                           │   │
│  │  [Service Worker]  background.ts                          │   │
│  │   • owns OT engine, IndexedDB, signaling, mesh            │   │
│  │   • sequencer-leader election                             │   │
│  │   • routes ops between content scripts and peers          │   │
│  │   • broadcasts on chrome.runtime ports                    │   │
│  │                                                           │   │
│  │  [Content Script: ISOLATED world]  content.ts             │   │
│  │   • DOM event capture (capture phase, all_frames)         │   │
│  │   • re-dispatch of remote ops via Event constructors      │   │
│  │   • SVG awareness overlay (cursors, selection boxes)      │   │
│  │   • rrweb recorder (snapshots)                            │   │
│  │   • IIFEs into MAIN world for the page bridge             │   │
│  │                                                           │   │
│  │  [MAIN-world script]  page-bridge.ts                      │   │
│  │   • exposes window.polychrome { on, share, ... }          │   │
│  │   • talks to content script via window.postMessage        │   │
│  │   • loads adapter for current site if registered          │   │
│  │                                                           │   │
│  │  [Side Panel UI]   React + Chakra UI v3                   │   │
│  │   • peer list, room controls, replay timeline             │   │
│  │                                                           │   │
│  │  [Devtools Panel]  React + Chakra UI v3                   │   │
│  │   • op log inspector, single-step replay                  │   │
│  │                                                           │   │
│  │  [Popup]           React + Chakra UI v3                   │   │
│  │   • quick join/leave                                      │   │
│  │                                                           │   │
│  │  [Options Page]    React + Chakra UI v3                   │   │
│  │   • signaling backend, TURN config, identity              │   │
│  │                                                           │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                  │                      │
                  │ WebRTC datachannels  │ Signaling (SDP/ICE only)
                  ▼                      ▼
            other peers              public signaling
            (mesh, ≤10)              (PeerJS / P2PCF / custom)
```

## Data flow: a local user clicks a button

1. **Capture** — `content.ts` listens on `document` in the capture phase.
   The native `click` event arrives. The handler:
   - Checks `event.isPolyChrome` — if set, this is a re-dispatched remote
     event; ignore to avoid loops.
   - Asks the page bridge whether the target element is "shareable" (the
     adapter for this site decides).
   - Builds an `Operation { kind: 'dom_event', payload: ... }` (see
     `02-protocol.md`).
2. **To background** — content script forwards via `chrome.runtime`
   port to the service worker.
3. **OT submit** — service worker calls `ot.submit(op)`. If this peer is
   the sequencer-leader, it assigns `seq` immediately; otherwise it sends
   the op to the leader over the mesh and awaits the assigned `seq`.
4. **Persist** — service worker appends to IndexedDB (`op_log` store).
5. **Broadcast** — service worker sends the op to all other peers over
   their datachannels. Each peer receives, transforms against any
   concurrent ops, persists, and forwards to its own content scripts.
6. **Re-dispatch** — receiving peers' content scripts re-construct the
   DOM event with `isPolyChrome = true` and `dispatchEvent` it on the
   resolved target. The page reacts as if the local user clicked.

## Data flow: replay

1. User scrubs the side-panel timeline to seq `T`.
2. Side panel sends `replay/seek { seq: T }` to service worker.
3. Service worker pauses live op forwarding to content scripts.
4. Service worker finds the **nearest snapshot** at `seq <= T` in
   IndexedDB and sends a `replay/restore` to all content scripts.
5. Content scripts wipe the page (or restore via rrweb's player into a
   sandbox iframe; design choice — see `06-replay.md`) and apply the
   snapshot.
6. Service worker streams ops from `snapshot.seq + 1` to `T` to content
   scripts at playback speed; each op is dispatched through the same
   `executeRemoteOp()` path used for live events.
7. On "resume live," service worker discards any forked ops and resumes
   forwarding live ops.

## Why this split

- **Service worker holds the truth.** It owns the op log, the OT engine,
  and the mesh. It outlives any single tab. When the SW sleeps (MV3
  lifecycle), `chrome.alarms` keeps it warm only while a session is
  active.
- **Content script is the only thing with DOM access.** Everything that
  touches the page lives there. It is pure I/O around the SW's brain.
- **Page bridge in MAIN world** is the only way page JavaScript can call
  our API (`window.polychrome.share(...)`). Content scripts run in the
  isolated world and cannot expose globals to the page.
- **UI surfaces are separate documents** (side panel, devtools, popup,
  options). They talk to the SW via `chrome.runtime.sendMessage` /
  long-lived ports. No direct access to content scripts.

## Build & deployment

- Monorepo with **pnpm workspaces**.
- **Turborepo** for parallel/cached builds.
- **Vite + `@crxjs/vite-plugin`** builds the extension; dev mode does HMR
  for content scripts and UI surfaces.
- `pnpm build` produces a loadable unpacked extension at
  `apps/extension/dist`.
- Examples are static sites built with Vite, hosted anywhere.
- No Docker, no servers, no CI for backend (because there is none). CI
  runs lint + unit + Playwright E2E (loads extension, opens two pages,
  asserts cross-page event delivery).

## Repository layout (post-scaffold)

```
PolyChrome/
├── apps/
│   └── extension/
│       ├── manifest.json
│       ├── src/
│       │   ├── background/         # owned by Track H
│       │   ├── content/            # owned by Track I
│       │   ├── main-world/         # owned by Track J
│       │   ├── storage/            # owned by Track D
│       │   ├── signaling/          # owned by Track E
│       │   ├── adapters/           # owned by Track N (subdirs per site)
│       │   └── ui/
│       │       ├── sidepanel/      # owned by Track K
│       │       ├── devtools/       # owned by Track L
│       │       ├── popup/          # owned by Track M
│       │       └── options/        # owned by Track M
│       └── vite.config.ts
├── packages/
│   ├── protocol/                   # owned by Track B
│   ├── ot-core/                    # owned by Track C
│   ├── replay-player/              # owned by Track G
│   └── sdk/                        # owned by Track F
├── examples/                       # owned by Track O
│   ├── drawing/
│   ├── scatterplot/
│   └── choropleth/
├── docs/
│   └── plan/                       # this directory
├── legacy/                         # old 2014 code, archived by Track A
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
└── tsconfig.base.json
```
