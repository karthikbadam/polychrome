# Track J - MAIN-world Page Bridge

**Wave**: 4 (after F)
**Depends on**: A, B, F
**Blocks**: N (adapters need `window.polychrome`)

## Goal

The MAIN-world script that exposes `window.polychrome` to page
JavaScript. Loaded via `chrome.scripting.executeScript({ world:
'MAIN', files: [...] })` from the content script (Track I).

This is essentially a thin wrapper around `@polychrome/sdk` that
plumbs its dispatch layer onto `window.postMessage` and listens for
incoming messages from the content script.

## Files I own (exclusive)

- `apps/extension/src/main-world/page-bridge.ts` - the entrypoint that
  becomes `page-bridge.js` in `dist/`
- `apps/extension/src/main-world/install.ts` - installer helper
- `apps/extension/src/main-world/__tests__/**`

## Spec

The bridge:
1. Constructs an instance of the SDK's API-shape.
2. Pipes its dispatcher to `window.postMessage` (BridgeEnvelope from
   protocol).
3. Listens for incoming `BridgeEnvelope`s and routes them to the SDK's
   internal subscribers.
4. Sets `window.polychrome = sdkInstance` (and `Object.freeze`s the
   shape).
5. Calls `dispatchEvent(new CustomEvent('polychrome:ready'))` so page
   scripts that load before the bridge can wait for it.

## Contract with content script

- The bridge sends BridgeEnvelopes; content script listens for
  `event.source === window && event.data.__polychrome === true`.
- The content script forwards SDK-relevant SW messages back as
  BridgeEnvelopes (`{ type: 'content/event', eventName, data }`).

## Integration with adapters

Adapters (Track N) are also injected into MAIN world. They:
- Wait for `polychrome:ready` (or check `window.polychrome` directly).
- Register their site-specific element-finders and event listeners.
- Call `polychrome.share(...)`, `polychrome.list(...)`, etc.

The bridge does NOT load adapters; the content script does, after
verifying the URL matches an allowlist entry.

## Tests

- Posts a `state_set` BridgeEnvelope when `polychrome.share('x', 1)`
  is called.
- Receives a `content/event` and fires the right `on()` listener.
- Multiple subscribers to the same key all fire on update.
- `polychrome:ready` fires exactly once.

## Acceptance

- [ ] `window.polychrome` is present and frozen on every page where
      the content script runs.
- [ ] Page-side `polychrome.share('x', 1)` results in an op being
      submitted to the SW (verified end-to-end by Track Z).
- [ ] No globals beyond `window.polychrome` are added.
- [ ] Bundle size < 35KB (production, not gzipped).

## Notes for the agent

- This file becomes a JS bundle that lives in `web_accessible_resources`
  per `07-extension-runtime.md`.
- The bridge MUST NOT import anything from the extension's other code
  (it runs in MAIN world; no chrome.* access). It can only import
  `@polychrome/protocol` and `@polychrome/sdk`.
- Be defensive: pages may include conflicting globals; use
  `Object.defineProperty` with `writable: false`.
