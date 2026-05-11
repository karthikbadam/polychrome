/**
 * snapshots.ts - snapshots store operations.
 *
 * putSnapshot  - gzip the raw data before storing.
 * nearestSnapshot - walk cursor backward from beforeSeq to find the
 *                   most recent snapshot of the given type.
 * listSnapshots - all snapshots for a session (metadata, no data inflation).
 */

import { makeLogger } from '@polychrome/protocol';
import type { SessionId, Seq } from '@polychrome/protocol';
import { gzipSync, gunzipSync } from 'fflate';
import type { IDBPDatabase } from 'idb';
import type { PolychromeDBSchema } from './db.js';
import type { SnapshotRecord, SnapshotType } from './types.js';

const log = makeLogger('storage:snapshots');

/**
 * Store a snapshot, gzip-compressing the data in place.
 * The caller passes a raw (uncompressed) Uint8Array or ArrayBuffer.
 */
export async function putSnapshot(
  db: IDBPDatabase<PolychromeDBSchema>,
  record: SnapshotRecord,
): Promise<void> {
  // Compress the data before storing
  const raw = record.data instanceof Uint8Array
    ? record.data
    : new Uint8Array(record.data);
  const compressed = gzipSync(raw);
  const stored: SnapshotRecord = {
    ...record,
    data: compressed.buffer,
    size: compressed.byteLength,
  };
  await db.put('snapshots', stored);
  log.debug('putSnapshot seq=%d type=%s size=%d', record.seq, record.type, stored.size);
}

/**
 * Return the most-recent snapshot of `type` whose `seq <= beforeSeq`.
 * Data is gunzip-decompressed before being returned.
 * Returns null if none found.
 */
export async function nearestSnapshot(
  db: IDBPDatabase<PolychromeDBSchema>,
  sessionId: SessionId,
  beforeSeq: Seq,
  type: SnapshotType,
): Promise<SnapshotRecord | null> {
  const range = IDBKeyRange.bound([sessionId, 0], [sessionId, beforeSeq]);
  const tx = db.transaction('snapshots', 'readonly');
  // Walk backward through the primary key index
  let cursor = await tx.objectStore('snapshots').openCursor(range, 'prev');
  while (cursor !== null) {
    if (cursor.value.type === type) {
      const compressed = new Uint8Array(cursor.value.data);
      const decompressed = gunzipSync(compressed);
      const result: SnapshotRecord = {
        ...cursor.value,
        data: decompressed.buffer,
        size: decompressed.byteLength,
      };
      log.debug('nearestSnapshot found seq=%d', cursor.value.seq);
      return result;
    }
    cursor = await cursor.continue();
  }
  log.debug('nearestSnapshot: none found for session=%s beforeSeq=%d type=%s', sessionId, beforeSeq, type);
  return null;
}

/**
 * List all snapshots for a session (sorted by seq ascending).
 * Returns records with their compressed data as-stored.
 */
export async function listSnapshots(
  db: IDBPDatabase<PolychromeDBSchema>,
  sessionId: SessionId,
): Promise<SnapshotRecord[]> {
  const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
  return db.getAll('snapshots', range);
}
