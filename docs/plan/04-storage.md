# 04 - Storage (IndexedDB)

Owned by Track D (`apps/extension/src/storage/`). The service worker is
the only consumer; UI surfaces query through SW messages.

## Database

- DB name: `polychrome`
- Version: 1
- Wrapper: [`idb`](https://github.com/jakearchibald/idb) v8

## Object stores

### `sessions`

```ts
{
  sessionId: SessionId;       // primary key
  createdAt: number;
  createdBy: ActorId;
  lastActiveAt: number;
  url: string;                // canonical page URL the session is anchored to
  passcodeHash?: string;      // bcrypt-style hash if room is gated
  meta: { title?: string; participants: ActorId[]; };
}
```

Indexes: `lastActiveAt` (for "recent sessions" UI).

### `op_log`

```ts
{
  sessionId: SessionId;
  seq: Seq;                    // composite primary key with sessionId
  op: Operation;               // full op
}
```

Composite key: `[sessionId, seq]`. Indexes:
- `[sessionId, ts]` - for time-based queries
- `[sessionId, kind]` - for filtered timeline views
- `[sessionId, actorId]` - for "show only my ops"

### `snapshots`

```ts
{
  sessionId: SessionId;
  seq: Seq;                    // composite primary key with sessionId - the seq this snapshot is *after*
  type: 'rrweb' | 'state';
  data: ArrayBuffer;           // gzipped rrweb events or shared-state JSON
  size: number;
  createdAt: number;
}
```

Composite key: `[sessionId, seq]`. Indexes: `[sessionId, type]`.

### `peers`

Local cache of recent peers' display info, for offline UX.

```ts
{
  actorId: ActorId;            // primary key
  name: string;
  color: string;
  lastSeenAt: number;
  lastSessionId?: SessionId;
}
```

### `identity`

Single-row store keyed by `'self'`.

```ts
{
  id: 'self';
  actorId: ActorId;
  name: string;
  color: string;
  createdAt: number;
}
```

## Public API

```ts
// apps/extension/src/storage/index.ts
export const Storage = {
  init(): Promise<void>;

  // sessions
  createSession(s: SessionRecord): Promise<void>;
  getSession(id: SessionId): Promise<SessionRecord | null>;
  listSessions(): Promise<SessionRecord[]>;
  touchSession(id: SessionId): Promise<void>;
  deleteSession(id: SessionId): Promise<void>;

  // op_log
  appendOp(op: Operation): Promise<void>;
  appendOps(ops: Operation[]): Promise<void>;       // batched txn
  getOps(sessionId: SessionId, fromSeq: Seq, toSeq: Seq): AsyncIterable<Operation>;
  getOp(sessionId: SessionId, seq: Seq): Promise<Operation | null>;
  lastSeq(sessionId: SessionId): Promise<Seq>;
  countOps(sessionId: SessionId): Promise<number>;

  // snapshots
  putSnapshot(s: SnapshotRecord): Promise<void>;
  nearestSnapshot(sessionId: SessionId, beforeSeq: Seq, type: 'rrweb'|'state'): Promise<SnapshotRecord | null>;
  listSnapshots(sessionId: SessionId): Promise<SnapshotRecord[]>;

  // identity
  getIdentity(): Promise<IdentityRecord>;
  updateIdentity(patch: Partial<IdentityRecord>): Promise<void>;

  // export / import
  exportSession(id: SessionId): Promise<Blob>;       // .polychrome.zip
  importSession(blob: Blob): Promise<SessionId>;
};
```

## Cadence & limits

- Snapshots are taken at **30s intervals OR every 500 ops**, whichever
  comes first. Configurable in Options.
- Op-log retention: unbounded by default. UI exposes "Trim before
  seq=N" and "Forget session" actions.
- Soft size cap: 500 MB of IndexedDB usage; warn the user via a banner
  in the side panel when crossing 80%.

## Export / import format

A `.polychrome.zip` contains:

```
manifest.json          // { version: 1, sessionId, createdAt, lastSeq, schema: 1 }
session.json           // SessionRecord
ops.jsonl              // one Operation per line, ordered by seq
snapshots/
  rrweb-<seq>.json.gz  // rrweb event arrays
  state-<seq>.json.gz  // shared-state snapshots
peers.json             // PeerRecord[] (for display name resolution)
```

Importing creates a *new* session id (random) so users can replay
without joining the original room.

## Acceptance for Track D

- [ ] `init()` is idempotent and migrates correctly.
- [ ] 10k op append + read benchmark completes in < 1s.
- [ ] Crash test: kill service worker mid-write - on reopen,
      `lastSeq()` reflects the last fully-committed op only.
- [ ] Export/import round-trip preserves every op exactly.
- [ ] No use of `localStorage`, `sessionStorage`, or
      `chrome.storage.session`.
- [ ] Memory cap respected: a 100k-op log doesn't load into memory at
      once (uses IDB cursor streaming).
