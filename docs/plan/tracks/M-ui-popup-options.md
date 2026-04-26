# Track M - Popup + Options UI

**Wave**: 5 (after H)
**Depends on**: A, B, H
**Blocks**: nothing

## Goal

Two small UI surfaces:
- **Popup** - toolbar-icon click; quick join/leave.
- **Options** - full-page settings (signaling adapter, TURN servers,
  identity, snapshot cadence).

Both built with React + Chakra UI v3.

## Files I own (exclusive)

### Popup
- `apps/extension/src/ui/popup/index.html`
- `apps/extension/src/ui/popup/index.tsx`
- `apps/extension/src/ui/popup/App.tsx`
- `apps/extension/src/ui/popup/__tests__/**`

### Options
- `apps/extension/src/ui/options/index.html`
- `apps/extension/src/ui/options/index.tsx`
- `apps/extension/src/ui/options/App.tsx`
- `apps/extension/src/ui/options/sections/SignalingSection.tsx`
- `apps/extension/src/ui/options/sections/TurnSection.tsx`
- `apps/extension/src/ui/options/sections/IdentitySection.tsx`
- `apps/extension/src/ui/options/sections/SnapshotsSection.tsx`
- `apps/extension/src/ui/options/sections/AllowlistSection.tsx`
- `apps/extension/src/ui/options/sections/DataSection.tsx` - export/clear
- `apps/extension/src/ui/options/state/store.ts`
- `apps/extension/src/ui/options/__tests__/**`

### Shared
- `apps/extension/src/ui/_shared/theme.ts` - Chakra theme used by all
  three UI surfaces (Track K may co-author; coordinate via the theme
  file as the single owner - define here, K imports)

## Popup spec

```
┌─────────── Popup (320x400) ──────────┐
│ PolyChrome 2.0                       │
│ ──────────────────────────────────── │
│ [ Status: not in a session ]         │
│                                      │
│ [ Create new session ]               │
│ ┌──────────────────────────────────┐ │
│ │  Join with code: [______]  [Go] │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Recent sessions:                     │
│  • G7K2QM (3 hours ago)              │
│  • ABCDEF (yesterday)                │
│                                      │
│ [ Open side panel ]  [ Settings ]    │
└──────────────────────────────────────┘
```

When already in a session:
- Show room code, peer count, status dot.
- Buttons: "Leave", "Open side panel", "Open replay".

## Options spec

Sections (Chakra `Tabs`):

1. **Signaling**
   - Adapter dropdown: `peerjs-public` / `p2pcf-worker` / `mdns-fallback`.
   - For `p2pcf-worker`: URL field.
2. **TURN / STUN**
   - List of `RTCIceServer` entries (URLs, optional username/credential).
   - "Add server" button.
3. **Identity**
   - Display name input.
   - Color picker (constrained to a palette of 12 distinguishable hues).
   - Show generated `actorId`.
4. **Snapshots**
   - Cadence (seconds + op-count, two number inputs).
   - Enable/disable rrweb snapshots toggle.
5. **Allowlist**
   - Show enabled site adapters with ✓.
   - Per-site toggle.
   - "Add custom site" - text field for URL pattern (advanced).
6. **Data**
   - Total IndexedDB usage gauge.
   - "Export all sessions" button.
   - "Clear all data" button (red, with confirm).

All settings stored via `chrome.storage.local` under namespaced keys.
SW reads on startup and re-reads on `chrome.storage.onChanged`.

## SW messaging

Both surfaces talk to SW via `chrome.runtime.sendMessage` (no
long-lived port needed - these are short-lived UIs).

## Tests

- Popup renders correctly with and without active session
  (mock SW message).
- Options form validates and persists (mocked
  `chrome.storage.local`).

## Acceptance

- [ ] Popup opens in <200ms; no flash of unstyled content.
- [ ] Join-code flow works end-to-end with a mocked SW.
- [ ] Options changes propagate to SW within 1s (verified via
      `storage.onChanged` listener).
- [ ] Allowlist changes update content-script `matches` at next
      page load (requires SW to update dynamically; coordinate with
      Track H).
- [ ] All inputs accessible via keyboard; Lighthouse a11y > 95.

## Notes for the agent

- All three UI surfaces (sidepanel, popup, options) share theme +
  Chakra Provider setup. Define once in `_shared/theme.ts`; import
  from each entrypoint.
- Don't bundle React per-surface - Vite will dedupe via the
  workspace. Confirm with `pnpm build` output.
- Popup must remain functional even when SW is asleep; first message
  wakes it (visible "connecting…" spinner is fine for ≤2s).
