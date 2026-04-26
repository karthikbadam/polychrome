# Track F — Page-side SDK (`@polychrome/sdk`)

**Wave**: 3 (parallel with C, D, E, G)
**Depends on**: A, B
**Blocks**: J, N, O

## Goal

Implement `@polychrome/sdk` — the page-side library that
PolyChrome-aware visualizations import to register interactive elements
and shared state. It is also what the MAIN-world page bridge (Track J)
uses internally.

## Files I own (exclusive)

- `packages/sdk/package.json` (replace stub)
- `packages/sdk/src/index.ts`
- `packages/sdk/src/api.ts` — the public `polychrome` object shape
- `packages/sdk/src/store.ts` — `share`, `subscribe`, `unsubscribe`
- `packages/sdk/src/lists.ts` — list-OT helpers
- `packages/sdk/src/checkpoint.ts`
- `packages/sdk/src/declarative.ts` — data-attribute scanner
- `packages/sdk/src/dispatch.ts` — bridge envelope dispatcher
- `packages/sdk/src/__tests__/**`

## Public API

```ts
// What page authors (or adapters) see on `window.polychrome`
export interface PolyChromeApi {
  /** Read/write a shared key. Returns a Subscriber. */
  share<T>(key: string, initialValue?: T): Shared<T>;

  /** Read-only subscription. */
  subscribe<T>(key: string, cb: (value: T) => void): Unsubscribe;

  /** List ops: insert/remove ordered items. */
  list<T>(listId: string): SharedList<T>;

  /** Drop a checkpoint into the timeline. */
  checkpoint(label: string): void;

  /** Identity of the local actor. */
  readonly self: { actorId: string; name: string; color: string };

  /** Other actors currently in the room. */
  peers(): { actorId: string; name: string; color: string; idle: boolean }[];

  /** Listen for events from the SW (e.g., presence changes). */
  on(event: 'peers' | 'state' | 'replay-start' | 'replay-end', cb: (e: any) => void): Unsubscribe;
  off(event: string, cb: any): void;
}

export interface Shared<T> {
  get(): T;
  set(value: T): void;
  subscribe(cb: (value: T) => void): Unsubscribe;
}

export interface SharedList<T> {
  get(): T[];
  insert(index: number, value: T): void;
  delete(index: number): void;
  subscribe(cb: (value: T[]) => void): Unsubscribe;
}
```

## Declarative integration

For non-developers, the SDK can scan the DOM for `data-pc-*`
attributes and auto-wire them:

```html
<input data-pc-share="filter.year" type="range" min="2000" max="2020">
<button data-pc-checkpoint="user-clicked-export">Export</button>
<ul data-pc-list="annotations">
  <li>...</li>
</ul>
```

`declarative.ts` runs on `DOMContentLoaded` (and on MutationObserver
for dynamic insertions), wires each tagged element to the appropriate
SDK call, and keeps DOM in sync with shared state.

## Bridge dispatch

The SDK is loaded in MAIN world. It does NOT have access to
`chrome.runtime`. It communicates with the content script (which has
access) via `window.postMessage` using `BridgeEnvelope` from
`@polychrome/protocol`.

`dispatch.ts` is the message bus:
- `send(msg: BridgeMsg): void` posts to `window` with `__polychrome:
  true`.
- `listen(cb: (msg: BridgeMsg) => void): Unsubscribe` filters incoming
  postMessage events and dispatches.

## Tests

- All public methods exercised against a mocked dispatch (no real
  postMessage; spy on `window.postMessage`).
- Declarative scanner picks up tagged elements and emits correct
  `share` / `list_op` calls.
- Subscription lifecycle: subscribe, unsubscribe, no leaked listeners.

## Acceptance

- [ ] `Shared<T>.set` triggers a single `state_set` bridge message.
- [ ] `SharedList<T>.insert` triggers a single `list_insert` bridge
      message.
- [ ] Declarative scanner can wire a `<input data-pc-share="x">` so
      that page changes propagate via the bridge.
- [ ] Bundle size (production build, not gzipped) under 30KB.
- [ ] No dependency on React, Chakra, or any UI library.
- [ ] Works in any modern browser (no Chrome-specific APIs except via
      bridge).

## Notes for the agent

- Authors will load this via `<script type="module" src=".../sdk.js">`.
  Build a bundled, ESM-only entrypoint.
- Also publish a `polychrome.iife.js` for legacy script-tag usage.
- The SDK is shared by the MAIN-world bridge AND by hosted examples.
  Build it as a normal npm package; the bridge imports it.
