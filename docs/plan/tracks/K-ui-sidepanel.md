# Track K — Side Panel UI

**Wave**: 5 (after H)
**Depends on**: A, B, H
**Blocks**: nothing (terminal)

## Goal

The persistent side-panel UI users see while in a session. Built with
React + **Chakra UI v3**.

Three primary surfaces in the side panel:
1. **Room** — create/join, room code, peer list with avatars.
2. **Timeline** — replay scrubber, snapshot markers, checkpoints,
   undo/redo.
3. **Activity** — live event feed (filterable), branching controls.

## Files I own (exclusive)

- `apps/extension/src/ui/sidepanel/index.html`
- `apps/extension/src/ui/sidepanel/index.tsx` — React entry
- `apps/extension/src/ui/sidepanel/App.tsx`
- `apps/extension/src/ui/sidepanel/views/Room.tsx`
- `apps/extension/src/ui/sidepanel/views/Timeline.tsx`
- `apps/extension/src/ui/sidepanel/views/Activity.tsx`
- `apps/extension/src/ui/sidepanel/components/PeerList.tsx`
- `apps/extension/src/ui/sidepanel/components/Scrubber.tsx`
- `apps/extension/src/ui/sidepanel/components/EventRow.tsx`
- `apps/extension/src/ui/sidepanel/components/RoomCode.tsx`
- `apps/extension/src/ui/sidepanel/components/UndoRedo.tsx`
- `apps/extension/src/ui/sidepanel/state/store.ts` — Zustand store
- `apps/extension/src/ui/sidepanel/state/sw.ts` — SW messaging hook
- `apps/extension/src/ui/sidepanel/theme.ts` — Chakra v3 theme
- `apps/extension/src/ui/sidepanel/__tests__/**`

## Dependencies to add

- `react`, `react-dom` (workspace-wide; root devDependency or per-app)
- `@chakra-ui/react` v3.x
- `@emotion/react`
- `zustand` — light state management
- `@tanstack/react-virtual` — for the activity feed virtualization
- `react-icons` (or `@chakra-ui/icons`) for tab icons

## UX

```
┌──────── Side Panel (~360px wide) ────────┐
│  ┌───┬──────────┬──────────┐             │
│  │Rm │ Timeline │ Activity │             │
│  └───┴──────────┴──────────┘             │
│                                          │
│  ┌─────────────── Room ──────────────┐  │
│  │ Code: G7K2QM  [📋]  [Leave]       │  │
│  │ ──────────────────────────────────│  │
│  │ Peers (3):                        │  │
│  │  ● You              (host)        │  │
│  │  ● Alice          (active)        │  │
│  │  ● Bob              (idle)        │  │
│  │ ──────────────────────────────────│  │
│  │ [Export session]  [Branch here]   │  │
│  └────────────────────────────────────┘  │
│                                          │
│  Timeline tab: scrubber + checkpoints   │
│  Activity tab: virtualized event feed   │
└──────────────────────────────────────────┘
```

## Functional requirements

### Room view
- Create new session (allocates room code).
- Join existing session by code.
- Show peer list (color, name, idle indicator).
- Leave session.
- Export session to `.polychrome.zip`.
- "Branch from current state" — sends `branch` message to SW.

### Timeline view
- Horizontal scrubber, full session range.
- Snapshot markers as small dots.
- Checkpoint markers as labeled flags.
- Speed control (0.25x .. 8x).
- Play/Pause/Step buttons.
- Undo / Redo buttons (with shortcut hints).
- "Resume Live" button when scrubbing.

### Activity view
- Virtualized list of confirmed ops.
- Filter chips: by `OpKind`, by actor.
- Click row → jump timeline to that seq.

## SW messaging

`state/sw.ts` exposes a hook:

```ts
function useSw(): {
  session: SessionMeta | null;
  peers: Peer[];
  ops: Operation[];               // streamed
  status: 'idle'|'connecting'|'live'|'replaying'|'branched';
  cmd: {
    create(): Promise<SessionId>;
    join(code: SessionId): Promise<void>;
    leave(): Promise<void>;
    seek(seq: Seq, speed?: Speed): void;
    play(speed?: Speed): void;
    pause(): void;
    branch(atSeq: Seq): Promise<SessionId>;
    undo(seq: Seq): Promise<void>;
    redo(): Promise<void>;
    exportSession(): Promise<Blob>;
    importSession(blob: Blob): Promise<SessionId>;
  };
}
```

Talks to SW via a long-lived `chrome.runtime.connect({ name: 'pc-ui-sidepanel' })`.

## Theme

Chakra v3 theme in `theme.ts`. Two modes (light/dark) with peer-color
palette compatible with overlay (Track I).

## Tests

- Component tests with `@testing-library/react`.
- Store tests for `useSw` reducer logic with a mocked port.

## Acceptance

- [ ] Side panel opens via `chrome.sidePanel`.
- [ ] Create session → room code visible → joining peer sees self in
      peer list within 3s.
- [ ] Scrubbing the timeline sends `seek` and visibly updates the
      tab (verified by E2E test in Track Z).
- [ ] Activity feed scrolls smoothly at 10k op count
      (virtualization).
- [ ] Light/dark mode toggle persists across reloads.
- [ ] Lighthouse accessibility score > 95 on the side panel HTML.

## Notes for the agent

- Chakra v3 uses the new `Provider` + tokens system; reference current
  Chakra v3 docs (Jan 2026 era).
- The side panel is a separate document; all SW comms go through
  `chrome.runtime`. No DOM access to the active tab.
- Keep all business logic out of components; put it in the
  store/hook. Components are render + event-handler only.
