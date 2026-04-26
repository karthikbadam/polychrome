/**
 * Storage-internal record types for the polychrome IndexedDB.
 *
 * These types are NOT in @polychrome/protocol because they are
 * implementation details of the storage layer only.
 */

import type { SessionId, ActorId, Seq, Operation } from '@polychrome/protocol';

// ---------------------------------------------------------------------------
// sessions store
// ---------------------------------------------------------------------------

export interface SessionRecord {
  sessionId: SessionId;
  createdAt: number;
  createdBy: ActorId;
  lastActiveAt: number;
  url: string;
  passcodeHash?: string;
  meta: { title?: string; participants: ActorId[] };
}

// ---------------------------------------------------------------------------
// op_log store
// ---------------------------------------------------------------------------

export interface OpLogRecord {
  sessionId: SessionId;
  seq: Seq;
  op: Operation;
}

// ---------------------------------------------------------------------------
// snapshots store
// ---------------------------------------------------------------------------

export type SnapshotType = 'rrweb' | 'state';

export interface SnapshotRecord {
  sessionId: SessionId;
  seq: Seq;
  type: SnapshotType;
  /** Gzipped rrweb event array or gzipped shared-state JSON */
  data: ArrayBuffer;
  size: number;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// peers store
// ---------------------------------------------------------------------------

export interface PeerRecord {
  actorId: ActorId;
  name: string;
  color: string;
  lastSeenAt: number;
  lastSessionId?: SessionId;
}

// ---------------------------------------------------------------------------
// identity store
// ---------------------------------------------------------------------------

export interface IdentityRecord {
  id: 'self';
  actorId: ActorId;
  name: string;
  color: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Export format types
// ---------------------------------------------------------------------------

export interface ExportManifest {
  version: 1;
  sessionId: SessionId;
  createdAt: number;
  lastSeq: Seq;
  schema: 1;
}
