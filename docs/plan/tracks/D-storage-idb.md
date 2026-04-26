# Track D - Storage (IndexedDB)

**Wave**: 3 (parallel with C, E, F, G)
**Depends on**: A, B
**Blocks**: G, H

## Goal

Implement the IndexedDB persistence layer specified in
`docs/plan/04-storage.md`. Lives inside the extension because the SW is
the only consumer.

## Files I own (exclusive)

- `apps/extension/src/storage/index.ts`
- `apps/extension/src/storage/db.ts` - open + migrations
- `apps/extension/src/storage/sessions.ts`
- `apps/extension/src/storage/op-log.ts`
- `apps/extension/src/storage/snapshots.ts`
- `apps/extension/src/storage/identity.ts`
- `apps/extension/src/storage/peers.ts`
- `apps/extension/src/storage/export.ts` - zip out
- `apps/extension/src/storage/import.ts` - zip in
- `apps/extension/src/storage/types.ts` - local record types
- `apps/extension/src/storage/__tests__/**` - unit tests with
  `fake-indexeddb`

## Dependencies to add

- `idb` (jakearchibald/idb) - IndexedDB wrapper
- `fflate` - zip + gzip for export/import
- `fake-indexeddb` (dev) - for tests

## Spec

Implement the `Storage` API in full per `docs/plan/04-storage.md`. The
schema, indexes, cadence, and export/import format are normative.

## Implementation order

1. `db.ts` - `openPolychromeDB(): Promise<IDBPDatabase>`. v1 schema,
   migration scaffold for future versions.
2. `types.ts` - `SessionRecord`, `OpLogRecord`, `SnapshotRecord`,
   `IdentityRecord`, `PeerRecord`. (Not in protocol because they're
   storage-internal.)
3. `sessions.ts` - CRUD + `touchSession`.
4. `op-log.ts` - `appendOp` (single txn), `appendOps` (batched txn),
   `getOps` returning `AsyncIterable` (use IDBP cursor),
   `lastSeq` (cursor descending), `countOps`.
5. `snapshots.ts` - `putSnapshot` (gzip the data with fflate before
   storing), `nearestSnapshot` (cursor walking backward from
   `beforeSeq`).
6. `identity.ts` - get/update with `'self'` key.
7. `peers.ts` - touch on every observed peer.
8. `export.ts` - write `manifest.json` + `session.json` + `ops.jsonl`
   + `snapshots/*.json.gz` + `peers.json` into a single Blob.
9. `import.ts` - parse zip, validate manifest version, allocate new
   `sessionId`, write everything in a single big txn (or chunked if
   > 50MB).

## Tests

- Open/close cycle preserves data.
- 10k op append < 1s benchmark (`fake-indexeddb` perf is rough; treat
  as smoke test, real benchmark in E2E).
- Crash mid-write simulation: open db, start a write, abort the
  transaction, reopen, assert `lastSeq` unchanged.
- Export/import round-trip: 100 ops + 5 snapshots survive bit-exact.
- Concurrent access: two `appendOp` calls in flight don't corrupt
  composite key ordering.

## Acceptance

Per `docs/plan/04-storage.md`:

- [ ] All `Storage` methods implemented and unit-tested.
- [ ] No use of `localStorage` / `sessionStorage` /
      `chrome.storage.session`.
- [ ] `getOps` is streamed (constant memory regardless of session
      size).
- [ ] Export size for 1k ops + 1 rrweb snapshot is < 500KB
      (gzip working).
- [ ] DB schema migration framework in place even though there's only
      v1 (a `migrate(db, oldVersion, newVersion)` skeleton).

## Notes for the agent

- IndexedDB does not allow nested transactions. `appendOps` must do
  all writes in one `transaction('op_log', 'readwrite')` call.
- Composite keys: pass `[sessionId, seq]` as the key; store doesn't
  hold a `keyPath` so we can omit those fields from the record (or
  duplicate; choose duplicate for query convenience).
- Use `structuredClone` semantics - don't pre-serialize Operations to
  JSON; let IDB store them as objects.
- The `fflate` package works in workers (no DOM); use the worker entry
  to keep the SW responsive on big snapshots.
