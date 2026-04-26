# Track I — Content Script

**Wave**: 4 (after G; can start once G's API is fixed)
**Depends on**: A, B, G
**Blocks**: N (adapters need the bridge plumbing this script sets up)

## Goal

Implement the per-tab content script that runs in the **isolated**
world. It captures DOM events, re-dispatches remote ops, draws the
awareness overlay, captures rrweb snapshots, and bridges to the
MAIN-world page bridge (Track J).

## Files I own (exclusive)

- `apps/extension/src/content/index.ts` — entrypoint
- `apps/extension/src/content/capture.ts` — local DOM event capture
- `apps/extension/src/content/dispatch.ts` — remote op execution
- `apps/extension/src/content/overlay.ts` — SVG cursors + selection boxes
- `apps/extension/src/content/recorder.ts` — rrweb capture (driven by SW)
- `apps/extension/src/content/replay-sandbox.ts` — replay iframe
- `apps/extension/src/content/bridge.ts` — postMessage to MAIN world
- `apps/extension/src/content/sw-port.ts` — long-lived port to SW
- `apps/extension/src/content/__tests__/**`

## Dependencies to add

- `rrweb` (record only; replay lives in Track G's player)

## Spec

The capture/re-dispatch model is from `01-architecture.md` §"Data
flow: a local user clicks a button". The protocol message types come
from `07-extension-runtime.md`.

## Capture pipeline

```ts
document.addEventListener(eventType, (e) => {
  if ((e as any).isPolyChrome) return;             // skip re-dispatched
  const target = e.target as Element;
  if (!isShareable(target)) return;                // adapter-defined
  const ref = target.from(target);                 // TargetRef
  const op = buildDomEventOp(e, ref);
  swPort.postMessage({ type: 'op/local', op });
}, { capture: true, passive: true });
```

`isShareable` is delegated to the active adapter (or defaults to "all
elements" on PolyChrome-aware example pages).

## Re-dispatch pipeline

When SW pushes `{ type: 'op/dispatch', op }`:

```ts
const el = target.resolve(op.target!);
if (!el) { log.warn('target unresolved', op); return; }
const evt = constructEventFor(op);
(evt as any).isPolyChrome = true;
(evt as any).pcActorId = op.actorId;
(evt as any).pcSeq = op.seq;
el.dispatchEvent(evt);
overlay.flashTarget(el, peerColor(op.actorId));
```

`constructEventFor` switches on `op.payload.type`:
- `MouseEvent` for click/mousedown/mouseup
- `PointerEvent` for pointer*
- `TouchEvent` (rare; gated by feature detect)
- `KeyboardEvent` for keydown/keyup
- `InputEvent` for input
- Custom `'wheel'` / `'scroll'` via `dispatchEvent` after setting
  `scrollX`/`scrollY`

## Awareness overlay

A single `<div id="pc-overlay-root">` appended to `document.body` once
DOM is ready. Inside it, an SVG layer:
- One cursor element per peer (svg circle + label).
- Selection-box element per peer (svg rect, fade out after 2s).
- Updated via cursor messages from SW (`cursor/peer`).

Z-index = `2147483647`. `pointer-events: none` so it never intercepts
input.

## rrweb snapshot

Driven entirely by the SW: when SW sends
`{ type: 'snapshot/please' }`, content script:
1. Calls `rrweb.snapshot(document)` (or `rrweb.record({ checkoutEveryNms: 0 })`
   captured for one tick) to produce a full snapshot.
2. Posts `{ type: 'snapshot/rrweb', events, capturedAtSeq }` back.

Live rrweb recording is OFF by default; we do snapshots, not continuous
recording (continuous recording is the OT log).

## Replay sandbox

When SW sends `{ type: 'replay/start', snapshot }`:
1. Save handle to `document.body`.
2. Replace body with `<iframe id="pc-replay-frame" sandbox="allow-same-origin allow-scripts">`.
3. Wait for iframe load, then construct a `RrwebSandbox` from
   `@polychrome/replay-player` against the iframe's contentWindow.
4. Suppress local capture during replay (`capture.pause()`).
5. Stream incoming `op/dispatch` messages into the sandbox via the
   replay player's `onApply`.

When SW sends `{ type: 'replay/end' }`: tear down iframe, restore body,
unpause capture.

## Bridge

`bridge.ts` is a thin wrapper around `window.postMessage`:
- Sends `BridgeEnvelope`s to MAIN world.
- Receives `BridgeEnvelope`s from MAIN world; forwards to SW.

The MAIN-world bridge JS itself is injected by `index.ts` on startup
via `chrome.scripting.executeScript({ world: 'MAIN', files: [...] })`.

## Coordinate normalization

All captured events go through `coords.toIdeal` (from protocol) before
being sent to the SW. All re-dispatched events go through
`coords.fromIdeal` before `dispatchEvent`.

## Tests

- Capture loop ignores re-dispatched events.
- Re-dispatch resolves targets correctly via `TargetRef.resolve` on a
  test DOM (happy-dom).
- Overlay creates exactly one root, removed on unload.
- Replay sandbox creation is idempotent; double-start is a no-op.

## Acceptance

- [ ] All event types in `DomEventPayload` are captured and
      re-dispatched correctly.
- [ ] Overlay renders peer cursors at the correct ideal-scaled
      coordinates.
- [ ] No event re-dispatch loops (verified by counting handler
      invocations in unit test).
- [ ] On `document_start`, capture is in place before any user input.
- [ ] Replay sandbox correctly isolates the page during scrub.
- [ ] Memory: overlay nodes pooled; no growth after 10k cursor moves.

## Notes for the agent

- Use `runtime.connect` (long-lived port), not `sendMessage`, for ops.
  Reduces per-message wakeups of the SW.
- All event listeners must be `{ capture: true, passive: true }`
  unless we explicitly need to `preventDefault` (we don't, in v1).
- Use `WeakSet` for the "this event was re-dispatched" marker to
  avoid memory issues.
- Do NOT import from `apps/extension/src/background/`. Communication
  is messages-only.
