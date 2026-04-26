/**
 * apps/extension/src/storage/index.ts
 *
 * Public surface of the storage layer.
 *
 * The background service worker (Track H) is the only consumer; it imports
 * `Storage` and calls `Storage.init()` before any other method.
 *
 * All types from @polychrome/protocol are re-used here. The local storage
 * record types (SessionRecord, SnapshotRecord, etc.) are exported so
 * Track H can annotate its variables without importing internals.
 */

import { makeLogger, newActorId } from '@polychrome/protocol';
import type { Operation, SessionId, Seq } from '@polychrome/protocol';
import type { IDBPDatabase } from 'idb';

import { openPolychromeDB, type PolychromeDBSchema } from './db.js';
import { exportSession } from './export.js';
import { getIdentity, updateIdentity } from './identity.js';
import { importSession } from './import.js';
import { appendOp, appendOps, getOps, getOp, lastSeq, countOps } from './op-log.js';
import { touchPeer, getPeer, listPeers } from './peers.js';
import { createSession, getSession, listSessions, touchSession, deleteSession } from './sessions.js';
import { putSnapshot, nearestSnapshot, listSnapshots } from './snapshots.js';

// Re-export record types so consumers don't need to import from sub-modules
export type {
  SessionRecord,
  OpLogRecord,
  SnapshotRecord,
  SnapshotType,
  PeerRecord,
  IdentityRecord,
  ExportManifest,
} from './types.js';

const log = makeLogger('storage');

// ---------------------------------------------------------------------------
// Module-level DB handle
// ---------------------------------------------------------------------------

let _db: IDBPDatabase<PolychromeDBSchema> | null = null;

/**
 * Get the open DB handle; throws if `Storage.init()` has not been called.
 */
function db(): IDBPDatabase<PolychromeDBSchema> {
  if (_db === null) {
    throw new Error('Storage.init() must be called before using Storage');
  }
  return _db;
}

// ---------------------------------------------------------------------------
// Storage — public API
// ---------------------------------------------------------------------------

export const Storage = {
  /**
   * Open (or reuse) the DB connection and seed identity if not present.
   * Idempotent — safe to call multiple times.
   *
   * @param dbName  Override the database name (used in tests for isolation).
   */
  async init(dbName?: string): Promise<void> {
    if (_db !== null) return;
    _db = await openPolychromeDB(dbName);

    // Seed identity row if not present
    const existing = await getIdentity(_db);
    if (existing === null) {
      await _db.put('identity', {
        id: 'self',
        actorId: newActorId(),
        name: 'Anonymous',
        color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
        createdAt: Date.now(),
      });
      log.info('identity seeded');
    }
    log.info('Storage.init() done');
  },

  /** Close the database connection. Subsequent calls to init() will reopen it. */
  close(): void {
    if (_db !== null) {
      _db.close();
      _db = null;
    }
  },

  // ---- sessions ----

  async createSession(s: import('./types.js').SessionRecord): Promise<void> {
    return createSession(db(), s);
  },

  async getSession(id: SessionId): Promise<import('./types.js').SessionRecord | null> {
    return getSession(db(), id);
  },

  async listSessions(): Promise<import('./types.js').SessionRecord[]> {
    return listSessions(db());
  },

  async touchSession(id: SessionId): Promise<void> {
    return touchSession(db(), id);
  },

  async deleteSession(id: SessionId): Promise<void> {
    return deleteSession(db(), id);
  },

  // ---- op_log ----

  async appendOp(op: Operation): Promise<void> {
    return appendOp(db(), op);
  },

  async appendOps(ops: Operation[]): Promise<void> {
    return appendOps(db(), ops);
  },

  getOps(sessionId: SessionId, fromSeq: Seq, toSeq: Seq): AsyncIterable<Operation> {
    return getOps(db(), sessionId, fromSeq, toSeq);
  },

  async getOp(sessionId: SessionId, seq: Seq): Promise<Operation | null> {
    return getOp(db(), sessionId, seq);
  },

  async lastSeq(sessionId: SessionId): Promise<Seq> {
    return lastSeq(db(), sessionId);
  },

  async countOps(sessionId: SessionId): Promise<number> {
    return countOps(db(), sessionId);
  },

  // ---- snapshots ----

  async putSnapshot(s: import('./types.js').SnapshotRecord): Promise<void> {
    return putSnapshot(db(), s);
  },

  async nearestSnapshot(
    sessionId: SessionId,
    beforeSeq: Seq,
    type: 'rrweb' | 'state',
  ): Promise<import('./types.js').SnapshotRecord | null> {
    return nearestSnapshot(db(), sessionId, beforeSeq, type);
  },

  async listSnapshots(sessionId: SessionId): Promise<import('./types.js').SnapshotRecord[]> {
    return listSnapshots(db(), sessionId);
  },

  // ---- identity ----

  async getIdentity(): Promise<import('./types.js').IdentityRecord> {
    const record = await getIdentity(db());
    if (record === null) {
      throw new Error('Storage: identity row not found; call init() first');
    }
    return record;
  },

  async updateIdentity(patch: Partial<Omit<import('./types.js').IdentityRecord, 'id'>>): Promise<void> {
    return updateIdentity(db(), patch);
  },

  // ---- peers ----

  async touchPeer(
    record: Omit<import('./types.js').PeerRecord, 'lastSeenAt'> & { lastSeenAt?: number },
  ): Promise<void> {
    return touchPeer(db(), record);
  },

  async getPeer(actorId: import('@polychrome/protocol').ActorId): Promise<import('./types.js').PeerRecord | null> {
    return getPeer(db(), actorId);
  },

  async listPeers(): Promise<import('./types.js').PeerRecord[]> {
    return listPeers(db());
  },

  // ---- export / import ----

  async exportSession(id: SessionId): Promise<Blob> {
    return exportSession(db(), id);
  },

  async importSession(blob: Blob): Promise<SessionId> {
    return importSession(db(), blob);
  },
};

export type StorageAPI = typeof Storage;
