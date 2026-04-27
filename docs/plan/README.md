# PolyChrome 2.0 - Implementation Plan

This directory is the plan, not the code. Read it top-to-bottom, then dispatch
parallel implementation sessions, one per file under `tracks/`.

## Goal

Rebuild PolyChrome (Badam & Elmqvist, ITS '14) as a modern **Chrome MV3
extension** with a **fully peer-to-peer architecture** and a **pure
Operational Transformation engine** that enables deterministic action
replay, undo, and branching. No backend server beyond a thin WebRTC
signaling relay. All persistence in IndexedDB.

## Decisions already locked in

| Decision | Choice | Rationale |
|---|---|---|
| Distribution | Chrome MV3 extension (Chromium browsers) | Sidesteps proxy fragility (CSP, cookies, OAuth, SPAs) |
| Sync model | **Pure OT** (no CRDT) | Canonical replayable history, server-free transforms, undo via inverses |
| Topology | **Fully P2P** WebRTC mesh | No backend to operate; sequencer-leader peer assigns global seq |
| Persistence | **IndexedDB** per peer + `.polychrome.zip` export | No server-side store |
| Identity | Anonymous + 6-char room passcode | Simplest demo experience |
| Site scope | **Curated allowlist** with per-site adapters | Reliable replay over generic-page best-effort |
| UI library | **Chakra UI v3** (React) | Modern, accessible, themeable; no Tailwind |
| Build | pnpm + Turborepo + Vite + `@crxjs/vite-plugin` | Standard MV3 toolchain |
| Lang | TypeScript everywhere | Shared types between SW, content, page, UI |

## Reading order

1. `01-architecture.md` - system diagram, process boundaries
2. `02-protocol.md` - **the canonical Operation schema; every track depends on this**
3. `03-ot-engine.md` - transform functions per op kind, leader election
4. `04-storage.md` - IndexedDB schema for op log + snapshots
5. `05-signaling.md` - signaling adapter contract (PeerJS / P2PCF / custom)
6. `06-replay.md` - snapshot cadence, scrubbing, branching, undo
7. `07-extension-runtime.md` - message routing across SW / content / MAIN-world

## Parallelization graph

```
                          ┌─────────────────┐
                          │ A. Scaffold     │  (must run first)
                          └────────┬────────┘
                                   │
                          ┌────────┴────────┐
                          │ B. Protocol     │  (foundation; tiny, fast)
                          └────────┬────────┘
                                   │
        ┌────────────┬─────────────┼─────────────┬────────────┐
        ▼            ▼             ▼             ▼            ▼
 ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
 │ C. OT    │ │ D. Storage │ │ E. Mesh  │ │ F. SDK   │ │ G. Replay│
 │   core   │ │  (IndexedDB│ │ (WebRTC+ │ │ (page-   │ │  player  │
 │          │ │  + idb)    │ │ signaling│ │  side)   │ │          │
 └────┬─────┘ └─────┬──────┘ └─────┬────┘ └────┬─────┘ └────┬─────┘
      │             │              │           │            │
      └─────────────┴──────┬───────┴───────────┤            │
                           ▼                   ▼            ▼
                  ┌─────────────────┐  ┌──────────────┐ ┌───────────┐
                  │ H. Background   │  │ J. Page      │ │ I. Content│
                  │   service worker│  │   bridge     │ │   script  │
                  │   (uses C,D,E)  │  │   (uses F)   │ │  (uses G) │
                  └────────┬────────┘  └──────┬───────┘ └─────┬─────┘
                           │                  │                │
                ┌──────────┼──────────┐       │                │
                ▼          ▼          ▼       │                │
          ┌─────────┐ ┌─────────┐ ┌────────┐  │                │
          │ K. Side │ │ L. Dev- │ │ M.     │  │                │
          │  panel  │ │  tools  │ │ Popup+ │  │                │
          │  UI     │ │  panel  │ │Options │  │                │
          └─────────┘ └─────────┘ └────────┘  │                │
                                              │                │
                                       ┌──────┴────┐    ┌──────┴────┐
                                       │N. Adapters│    │O. Examples│
                                       │ (per-site)│    │ (drawing, │
                                       │           │    │  scatter, │
                                       │           │    │  choro)   │
                                       └─────┬─────┘    └─────┬─────┘
                                             │                │
                                             └────────┬───────┘
                                                      ▼
                                          ┌──────────────────────┐
                                          │ Z. Integration & E2E │
                                          └──────────────────────┘
```

## Dispatch order

- **Wave 1** (sequential): A → B
- **Wave 2** (5-way parallel): C, D, E, F, G
- **Wave 3** (3-way parallel): H, I, J
- **Wave 4** (5-way parallel): K, L, M, N, O
- **Wave 5** (sequential): Z

Tracks within a wave have **non-overlapping file ownership** - see each
track file's "Files I own" section. Use `git worktree`-isolated Claude
Code sessions for true parallelism.

## Implementation status

Built and merged on the active branch:

| Track | Status | Notes |
|---|---|---|
| A scaffold | done | pnpm workspace, Vite + crxjs, Turborepo, ESLint/Prettier/Vitest |
| B protocol | done | `@polychrome/protocol`; 34 tests |
| C ot-core | done | transform/invert/leader/state; 45 tests (incl. TP1 property + 5-peer election sim) |
| D storage | done | IndexedDB op log + snapshots + identity + `.polychrome.zip` |
| E signaling+mesh | done | peerjs-public / p2pcf-worker / mdns adapters; 30Hz cursor throttle |
| F sdk | done | page-side `window.polychrome`; share/list/checkpoint; ESM 10KB / IIFE 11KB; 28 tests |
| G replay-player | done | `createTimeline()` widget (markers + scrub head + label); 17 jsdom tests; powers the side-panel History |
| H background SW | done | identity + room state in `chrome.storage.local`; long-lived runtime port hub |
| I content script | done | reads SW state, writes identity/room onto documentElement.dataset for the bridge |
| J page bridge | done | MAIN-world content script that installs `window.polychrome`, runs y-webrtc, drives live cursors, picks the matching site adapter |
| K side-panel UI | done | identity, room controls, peer list (deduped by actorId), History timeline, Undo last |
| L devtools panel | not started | brief in `tracks/L-ui-devtools.md` |
| M popup + options | partial | popup ships; options page still scaffolded |
| N site adapters | done (best-effort) | adapter registry + Mosaic adapter (best-effort: probes coordinator globals, mirrors selections); 24 tests |
| O examples | done | drawing, scatterplot, choropleth (D3 v7) - all wired through the kiosk transport |
| P publish (gh-pages) | done | landing page, `scripts/build-gh-pages.sh`, `.github/workflows/pages.yml` |
| Z integration | not started | end-to-end smoke once L/M land |

Out-of-plan addition: **`@polychrome/kiosk`** (`packages/kiosk/`) is a
Yjs-over-y-webrtc runtime shared by the hosted demos AND the
extension's MAIN-world bridge. It exposes `createPolyApi(ydoc, self)`
with `share`, `list`, `checkpoint`, `self`, and a `history` surface.
The history surface records every mutation into a shared Y.Array
(`polychrome:oplog`) that all peers see and the side panel renders
as a Timeline; `history.undo(record)` and `history.undoLastBy(actorId)`
apply inverses through the same observer-aware code path the demos
use. 34 tests.

The kiosk is a hosted-demo shortcut and the page bridge backbone.
The plan also describes an OT-with-event-capture path - recording
arbitrary DOM events as `Operation`s through per-site adapters into
`@polychrome/storage`'s op log; that path coexists in the codebase
but is not the path the demos use.

### Capture and replay

Today's sync model is Yjs CRDT (`Y.Map` for shared keys, `Y.Array`
for lists) plus a `polychrome:oplog` Y.Array carrying structured
records of each `share`/`list`/`checkpoint` write. Inversion is
implemented for `state_set`/`list_insert`/`list_delete`; the side
panel's "Undo last" button round-trips through the log via the same
observer-aware setters the demos use.

The op log lives in the Y.Doc for the active session. The
`@polychrome/storage` package is the on-disk home for op logs and
snapshots; today it's exercised by its own tests but not wired into
the kiosk's session log.

The Timeline widget in the side panel renders every record in the
log and exposes a scrub callback. The Undo button is what currently
mutates state through that surface; full state rewind by scrub head
is a separate piece.

## Conventions every track follows

- TypeScript strict mode. No `any` without a `// @reason` comment.
- Vitest for unit tests, colocated as `*.test.ts`.
- Public package APIs exported from `src/index.ts` only.
- No console.log in committed code; use the `Logger` from `packages/protocol`.
- Chakra UI v3 components (`@chakra-ui/react`) for all React surfaces.
- Imports from other packages use the workspace alias (e.g.,
  `@polychrome/protocol`), never relative `../../`.
- A track is "done" when its acceptance checklist passes AND `pnpm build`
  + `pnpm test` succeed for its package.

## What's out of scope for v1

- Firefox / Safari (Chromium only)
- More than ~10 peers per session (mesh topology limit)
- Server-side moderation, accounts, abuse handling
- Mobile browsers
- Offline-first co-browse (need at least one peer online to join)
- E2E encryption beyond room passcode HMAC
