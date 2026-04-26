# Track H — Background Service Worker

**Wave**: 4 (after C, D, E)
**Depends on**: A, B, C, D, E
**Blocks**: K, L, M

## Goal

Wire the OT engine, storage, and mesh into the MV3 service worker.
This is the brain — it's where every op enters and exits the system.

## Files I own (exclusive)

- `apps/extension/src/background/index.ts` — entrypoint
- `apps/extension/src/background/router.ts` — `chrome.runtime.onMessage` dispatcher
- `apps/extension/src/background/session.ts` — per-session controller
- `apps/extension/src/background/sessions-registry.ts` — many active sessions
- `apps/extension/src/background/keepalive.ts` — alarm-based SW pinger
- `apps/extension/src/background/snapshots.ts` — snapshot scheduler
- `apps/extension/src/background/ports.ts` — long-lived port management
- `apps/extension/src/background/__tests__/**`

## Spec

Implements:
- Message routing per `docs/plan/07-extension-runtime.md`.
- OT submit/ingest pipeline per `docs/plan/03-ot-engine.md`.
- Snapshot cadence per `docs/plan/06-replay.md`.

## Architecture

```
┌─────────────── Service Worker ────────────────┐
│                                                │
│  SessionsRegistry                              │
│   ├─ Session("G7K2QM")  ◄─ active room        │
│   │   ├─ OtEngine                              │
│   │   ├─ MeshManager                           │
│   │   ├─ SnapshotScheduler                     │
│   │   └─ tabs: Set<tabId>                      │
│   └─ Session("ABCDEF")  ◄─ another active room │
│                                                │
│  Router                                         │
│   ├─ from content scripts (chrome.runtime)     │
│   ├─ from UI surfaces (sendMessage / ports)    │
│   └─ to content scripts (tabs.sendMessage)     │
│                                                │
│  Keepalive (chrome.alarms)                     │
└────────────────────────────────────────────────┘
```

A `Session` owns one OtEngine, one MeshManager, and the set of tabs
participating. Multiple sessions can be active concurrently (e.g.,
user joins one in tab A, another in tab B).

## Implementation order

1. `keepalive.ts` — `chrome.alarms` registration; pings only while
   `sessionsRegistry.hasActive()`.
2. `ports.ts` — register handlers for content-script and UI ports;
   route them by `port.name` (`pc-content-${tabId}`, `pc-ui-sidepanel`,
   etc.).
3. `session.ts` — `Session` class with:
   - `start()`: opens mesh, joins signaling, restores from IDB if log
     exists, runs sync handshake.
   - `submitLocalOp(op)`: hands to OtEngine, persists, broadcasts,
     dispatches to tabs.
   - `ingestRemoteOp(op)`: hands to OtEngine, persists, dispatches to
     tabs.
   - `attachTab(tabId)` / `detachTab(tabId)`.
   - `seek(seq)`: orchestrates replay (notifies tabs).
   - `branch(atSeq)`: creates a new session via `Storage.import`-like
     copy.
4. `sessions-registry.ts` — `getOrCreate(sessionId)`, `close(id)`,
   `hasActive()`, `byTab(tabId)`.
5. `snapshots.ts` — `SnapshotScheduler` that, per session, watches the
   confirmed-op stream and triggers an rrweb snapshot via
   `chrome.tabs.sendMessage(tabId, { type: 'snapshot/please' })` every
   30s or 500 ops.
6. `router.ts` — `chrome.runtime.onMessage` and port handlers.
7. `index.ts` — sets up logging, registers everything.

## Sync handshake

When a peer joins (or rejoins) a session, after `hello`:
1. Each side sends `Envelope { type: 'sync_request', body: { lastSeq } }`.
2. Each side responds with `sync_response { ops: Operation[] }`
   containing missing ops.
3. Both apply received ops via OT, persist, dispatch.

For sessions with > 1000 missed ops, send the nearest snapshot
+ subsequent ops, not the full log.

## Tests

- Boot test: SW starts, opens IDB, idle (no session active) — keepalive
  off.
- Two-session test: two registry entries, isolated state.
- Replay/seek: SW pauses live dispatch, sends snapshot, then op
  stream, then resumes.
- Crash recovery: kill SW mid-op-batch, reopen, assert in-flight ops
  are re-fetched from leader on next sync.

## Acceptance

- [ ] All `SwToContent` and `ContentToSw` messages handled per
      `07-extension-runtime.md`.
- [ ] SW survives keepalive interval while a session is active.
- [ ] SW sleeps within 60s of last session closing (verify via
      `chrome.alarms.getAll`).
- [ ] No `chrome.runtime.lastError` warnings in the SW console under
      normal flow.
- [ ] Snapshot scheduler fires according to spec; snapshot stored in
      IDB; verifiable in devtools panel.

## Notes for the agent

- The SW's `globalThis` is volatile; persist anything that must
  survive sleep. Use `chrome.storage.local` only for tiny non-IDB
  metadata (e.g., last active session ids), never for ops.
- All async functions must handle SW termination mid-await (catch and
  resume on next wake).
- `import` from `@polychrome/ot-core`, `@polychrome/protocol`, and
  the local `storage/`, `signaling/` folders. NEVER from `content/`,
  `ui/`, or `main-world/`.
