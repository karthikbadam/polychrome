# Track B — Protocol Package

**Wave**: 2 (after A; blocks waves 3+)
**Depends on**: A (scaffold)
**Blocks**: C, D, E, F, G, H, I, J, K, L, M, N, O

## Goal

Implement `@polychrome/protocol` — the canonical type & helper package
every other module depends on. Pure TypeScript; no DOM, no chrome.*.

## Files I own (exclusive)

- `packages/protocol/package.json` (replace stub)
- `packages/protocol/src/types.ts`
- `packages/protocol/src/messages.ts`
- `packages/protocol/src/coords.ts`
- `packages/protocol/src/target.ts`
- `packages/protocol/src/codec.ts`
- `packages/protocol/src/envelope.ts`
- `packages/protocol/src/logger.ts`
- `packages/protocol/src/ids.ts`
- `packages/protocol/src/index.ts` (re-exports)
- `packages/protocol/src/**/*.test.ts`

## Spec

Implement everything specified in `docs/plan/02-protocol.md` and
`docs/plan/07-extension-runtime.md` (the message types section).

### `types.ts`
- `SessionId`, `ActorId`, `Seq`, `ClientSeq` brand types.
- `Operation` interface.
- `OpKind` union.
- All payload interfaces (`DomEventPayload`, `StateSetPayload`, ...).
- `TargetRef`.
- `SharedStateView` shape.

### `messages.ts`
- `SwToContent` and `ContentToSw` discriminated unions.
- `BridgeEnvelope` and `BridgeMsg`.
- `Envelope` (network).
- `SignalingMessage`.

### `coords.ts`
- `IDEAL_W = 1920`, `IDEAL_H = 1080`.
- `toIdeal({x, y, w, h})` and `fromIdeal({x, y, w, h})`.
- Round-trip 1px tolerance test.

### `target.ts`
- `TargetRef.from(element: Element): TargetRef` — prefers ID, falls
  back to xpath, includes rect & text.
- `TargetRef.resolve(ref: TargetRef, doc?: Document): Element | null` —
  selector → xpath → elementFromPoint → text-prefix.
- DOM dependency: import types from `lib.dom.d.ts`; runtime usage is
  only in the `resolve` function, which Node tests skip with a guard.

### `codec.ts`
- `encode(env: Envelope): string` and `decode(s: string): Envelope`.
- Validates protocol version, throws on unknown `kind`.
- v1: JSON; future-proof with a switch.

### `envelope.ts`
- Helpers: `wrapOp(op)`, `wrapBatch(ops)`, `wrapCursor(payload)`,
  `wrapHello(actorId)`, etc.

### `logger.ts`
- Tiny structured logger. `log.info`, `log.warn`, `log.error`,
  `log.debug` — namespaced; respects `localStorage.PC_LOG_LEVEL` /
  `process.env.PC_LOG_LEVEL`.
- All callers must use this; **no `console.log` allowed** anywhere
  else in the codebase (lint rule from Track A enforces this).

### `ids.ts`
- `newSessionId(): SessionId` — 6-char base32 (Crockford), 32 bits of
  entropy plus a checksum char (so 6 chars total).
- `newActorId(): ActorId` — UUIDv4.

## Public API

```ts
// packages/protocol/src/index.ts
export * from './types';
export * from './messages';
export * as coords from './coords';
export * as target from './target';
export * as codec from './codec';
export * as envelope from './envelope';
export { log } from './logger';
export { newSessionId, newActorId } from './ids';
export const PROTOCOL_VERSION = 1 as const;
```

## Acceptance

Per `docs/plan/02-protocol.md`:

- [ ] All types compile under `tsc --strict`.
- [ ] Codec round-trips every `OpKind`.
- [ ] Coord helpers are inverses to within 1px.
- [ ] `target.from` + `target.resolve` round-trip on a test DOM
      (use `happy-dom`).
- [ ] Property test: 1000 random ops survive
      `JSON.parse(JSON.stringify(op))`.
- [ ] Package exports nothing from `node:*`, `chrome.*`, or
      `indexedDB`.
- [ ] No runtime dependencies (only `devDependencies`).

## Notes for the agent

- Use branded types via `type Brand<T, B> = T & { readonly __brand: B }`
  pattern; export brand-aware constructors only.
- `id` selectors must be CSS.escape-d.
- Do not import `chrome.*` types — UI/extension code that needs them
  pulls `@types/chrome` itself.
