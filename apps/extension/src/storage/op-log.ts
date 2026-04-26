/**
 * op-log.ts - op_log store operations.
 *
 * appendOp / appendOps - write ops in a single transaction.
 * getOps - stream via IDB cursor (constant memory).
 * lastSeq - cursor descending to find the highest seq for a session.
 * countOps - total count for a session.
 */

import { makeLogger } from '@polychrome/protocol';
import type { Operation, SessionId, Seq } from '@polychrome/protocol';
import type { IDBPDatabase } from 'idb';
import type { PolychromeDBSchema } from './db.js';

const log = makeLogger('storage:op-log');

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function appendOp(
  db: IDBPDatabase<PolychromeDBSchema>,
  op: Operation,
): Promise<void> {
  const tx = db.transaction('op_log', 'readwrite');
  await tx.objectStore('op_log').put({ sessionId: op.sessionId, seq: op.seq, op });
  await tx.done;
  log.debug('appendOp seq=%d', op.seq);
}

export async function appendOps(
  db: IDBPDatabase<PolychromeDBSchema>,
  ops: Operation[],
): Promise<void> {
  if (ops.length === 0) return;
  const tx = db.transaction('op_log', 'readwrite');
  const store = tx.objectStore('op_log');
  for (const op of ops) {
    store.put({ sessionId: op.sessionId, seq: op.seq, op });
  }
  await tx.done;
  log.debug('appendOps count=%d', ops.length);
}

// ---------------------------------------------------------------------------
// Read - streaming
// ---------------------------------------------------------------------------

/**
 * Streams ops for [fromSeq, toSeq] inclusive via an IDB cursor.
 * Constant memory: the cursor fetches one record at a time.
 */
export async function* getOps(
  db: IDBPDatabase<PolychromeDBSchema>,
  sessionId: SessionId,
  fromSeq: Seq,
  toSeq: Seq,
): AsyncIterable<Operation> {
  const range = IDBKeyRange.bound([sessionId, fromSeq], [sessionId, toSeq]);
  const tx = db.transaction('op_log', 'readonly');
  let cursor = await tx.objectStore('op_log').openCursor(range);
  while (cursor !== null) {
    yield cursor.value.op;
    cursor = await cursor.continue();
  }
  log.debug('getOps sessionId=%s from=%d to=%d', sessionId, fromSeq, toSeq);
}

// ---------------------------------------------------------------------------
// Read - scalar queries
// ---------------------------------------------------------------------------

export async function getOp(
  db: IDBPDatabase<PolychromeDBSchema>,
  sessionId: SessionId,
  seq: Seq,
): Promise<Operation | null> {
  const record = await db.get('op_log', [sessionId, seq]);
  return record?.op ?? null;
}

export async function lastSeq(
  db: IDBPDatabase<PolychromeDBSchema>,
  sessionId: SessionId,
): Promise<Seq> {
  const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
  const tx = db.transaction('op_log', 'readonly');
  const cursor = await tx.objectStore('op_log').openCursor(range, 'prev');
  if (cursor === null) return 0 as Seq;
  return cursor.value.seq;
}

export async function countOps(
  db: IDBPDatabase<PolychromeDBSchema>,
  sessionId: SessionId,
): Promise<number> {
  const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
  return db.countFromIndex('op_log', 'by_ts', range);
}
