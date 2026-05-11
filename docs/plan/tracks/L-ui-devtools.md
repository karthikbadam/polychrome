# Track L - Devtools Panel

**Wave**: 5 (after H)
**Depends on**: A, B, H
**Blocks**: nothing

## Goal

A Chrome devtools panel for inspecting the OT op stream, leader
elections, transforms, and conflicts in real time. Built with React +
Chakra UI v3.

This is the developer-facing inspection surface - not for end users.

## Files I own (exclusive)

- `apps/extension/src/ui/devtools/devtools.html` - bootstraps panel
- `apps/extension/src/ui/devtools/devtools.ts` - registers the panel
- `apps/extension/src/ui/devtools/panel.html`
- `apps/extension/src/ui/devtools/panel.tsx` - React entry
- `apps/extension/src/ui/devtools/App.tsx`
- `apps/extension/src/ui/devtools/views/OpStream.tsx`
- `apps/extension/src/ui/devtools/views/Leader.tsx`
- `apps/extension/src/ui/devtools/views/State.tsx`
- `apps/extension/src/ui/devtools/views/Transforms.tsx` - visualizes
  transform pairs as they happen
- `apps/extension/src/ui/devtools/components/OpJsonView.tsx`
- `apps/extension/src/ui/devtools/state/store.ts`
- `apps/extension/src/ui/devtools/__tests__/**`

## Dependencies

Same as Track K (`react`, `@chakra-ui/react`, `zustand`, etc.). No
extra additions if Track K already added them at workspace root.

## UX

```
┌────────── Chrome Devtools Panel ──────────┐
│ [Op Stream] [Leader] [State] [Transforms] │
├────────────────────────────────────────────┤
│ Op Stream                                  │
│ ┌────┬──────┬───────────┬─────────┬────┐  │
│ │seq │actor │kind       │target   │... │  │
│ ├────┼──────┼───────────┼─────────┼────┤  │
│ │ 42 │ Bob  │dom_event  │#submit  │ ▶  │  │
│ │ 43 │ Alice│state_set  │filter.x │ ▶  │  │
│ └────┴──────┴───────────┴─────────┴────┘  │
│ ▶ click row → JSON pretty-printed below    │
│ Pause stream | Filter by kind/actor | Save │
└────────────────────────────────────────────┘
```

Tabs:
1. **Op Stream** - virtualized table of ops (live), click to expand
   JSON.
2. **Leader** - current leader actorId, last heartbeat, election
   history (last 20 events).
3. **State** - current `SharedStateView` as a tree explorer.
4. **Transforms** - when a non-identity transform happens, show the
   pair (a, b) and the result (b'). Useful for verifying OT
   behavior in dev.

## SW messaging

A long-lived port `pc-ui-devtools` subscribes to the SW's verbose op
stream:

```ts
type DevtoolsMsg =
  | { type: 'op/confirmed'; op: Operation; transformed?: { against: Operation; result: Operation } }
  | { type: 'leader/state'; leaderId: ActorId; term: number }
  | { type: 'state/snapshot'; state: SharedStateView }
  | { type: 'cmd/pause' | 'cmd/resume' | 'cmd/clear' };
```

The SW gates this stream so production users don't pay for the
verbose payload.

## Tests

- Op Stream renders 5k rows without jank (virtualized).
- Leader view updates within 100ms of a `leader/state` message.
- Transforms view shows the transform pair correctly for the four
  list-OT cases.

## Acceptance

- [ ] Panel registers and shows up as "PolyChrome" tab in DevTools.
- [ ] Live ops stream into the table.
- [ ] Pause/resume buttons work.
- [ ] State view reflects SW state to the byte.
- [ ] Transforms view fires on every non-identity transform.

## Notes for the agent

- Use `chrome.devtools.panels.create` in `devtools.ts`.
- The devtools panel is a separate document; messaging is via
  `chrome.runtime.connect`, not via `chrome.devtools.inspectedWindow`.
- Keep the panel light: heavy state lives in the SW; we just render.
