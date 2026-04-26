/**
 * db.ts — openPolychromeDB
 *
 * Opens (and if necessary upgrades) the 'polychrome' IndexedDB database.
 * All schema migrations are handled here.
 */

import type { SessionId, ActorId, Seq } from '@polychrome/protocol';
import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import type {
  SessionRecord,
  OpLogRecord,
  SnapshotRecord,
  PeerRecord,
  IdentityRecord,
} from './types.js';

// ---------------------------------------------------------------------------
// Schema definition for idb's typed API
// ---------------------------------------------------------------------------

export interface PolychromeDBSchema extends DBSchema {
  sessions: {
    key: SessionId;
    value: SessionRecord;
    indexes: {
      lastActiveAt: number;
    };
  };
  op_log: {
    key: [SessionId, Seq];
    value: OpLogRecord;
    indexes: {
      'by_ts': [SessionId, number];
      'by_kind': [SessionId, string];
      'by_actor': [SessionId, ActorId];
    };
  };
  snapshots: {
    key: [SessionId, Seq];
    value: SnapshotRecord;
    indexes: {
      'by_type': [SessionId, string];
    };
  };
  peers: {
    key: ActorId;
    value: PeerRecord;
  };
  identity: {
    key: 'self';
    value: IdentityRecord;
  };
}

// ---------------------------------------------------------------------------
// DB_NAME and DB_VERSION constants
// ---------------------------------------------------------------------------

export const DB_NAME = 'polychrome';
export const DB_VERSION = 1;

// ---------------------------------------------------------------------------
// Migration scaffold
// ---------------------------------------------------------------------------

function migrate(
  db: IDBPDatabase<PolychromeDBSchema>,
  oldVersion: number,
  _newVersion: number | null,
): void {
  if (oldVersion < 1) {
    // ---- v1: initial schema ----

    // sessions
    const sessions = db.createObjectStore('sessions', { keyPath: 'sessionId' });
    sessions.createIndex('lastActiveAt', 'lastActiveAt');

    // op_log — composite key [sessionId, seq]
    const opLog = db.createObjectStore('op_log', { keyPath: ['sessionId', 'seq'] });
    opLog.createIndex('by_ts', ['sessionId', 'op.ts']);
    opLog.createIndex('by_kind', ['sessionId', 'op.kind']);
    opLog.createIndex('by_actor', ['sessionId', 'op.actorId']);

    // snapshots — composite key [sessionId, seq]
    const snapshots = db.createObjectStore('snapshots', { keyPath: ['sessionId', 'seq'] });
    snapshots.createIndex('by_type', ['sessionId', 'type']);

    // peers
    db.createObjectStore('peers', { keyPath: 'actorId' });

    // identity — single-row store keyed by 'self'
    db.createObjectStore('identity', { keyPath: 'id' });
  }

  // Future migrations go here:
  // if (oldVersion < 2) { ... }
}

// ---------------------------------------------------------------------------
// openPolychromeDB
// ---------------------------------------------------------------------------

/**
 * Open the 'polychrome' IndexedDB, applying migrations as needed.
 *
 * @param dbName  Override the database name (used in tests for isolation).
 */
export async function openPolychromeDB(
  dbName: string = DB_NAME,
): Promise<IDBPDatabase<PolychromeDBSchema>> {
  return openDB<PolychromeDBSchema>(dbName, DB_VERSION, {
    upgrade(db, oldVersion, newVersion) {
      migrate(db, oldVersion, newVersion);
    },
  });
}
