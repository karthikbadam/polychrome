# PolyChrome 2.0 — Implementation Plan

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

1. `01-architecture.md` — system diagram, process boundaries
2. `02-protocol.md` — **the canonical Operation schema; every track depends on this**
3. `03-ot-engine.md` — transform functions per op kind, leader election
4. `04-storage.md` — IndexedDB schema for op log + snapshots
5. `05-signaling.md` — signaling adapter contract (PeerJS / P2PCF / custom)
6. `06-replay.md` — snapshot cadence, scrubbing, branching, undo
7. `07-extension-runtime.md` — message routing across SW / content / MAIN-world

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

Tracks within a wave have **non-overlapping file ownership** — see each
track file's "Files I own" section. Use `git worktree`-isolated Claude
Code sessions for true parallelism.

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
