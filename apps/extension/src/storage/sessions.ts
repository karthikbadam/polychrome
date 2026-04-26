/**
 * sessions.ts - CRUD operations for the `sessions` object store.
 */

import { makeLogger } from '@polychrome/protocol';
import type { SessionId } from '@polychrome/protocol';
import type { IDBPDatabase } from 'idb';
import type { PolychromeDBSchema } from './db.js';
import type { SessionRecord } from './types.js';

const log = makeLogger('storage:sessions');

export async function createSession(
  db: IDBPDatabase<PolychromeDBSchema>,
  record: SessionRecord,
): Promise<void> {
  await db.put('sessions', record);
  log.debug('createSession', record.sessionId);
}

export async function getSession(
  db: IDBPDatabase<PolychromeDBSchema>,
  id: SessionId,
): Promise<SessionRecord | null> {
  const record = await db.get('sessions', id);
  return record ?? null;
}

export async function listSessions(
  db: IDBPDatabase<PolychromeDBSchema>,
): Promise<SessionRecord[]> {
  return db.getAllFromIndex('sessions', 'lastActiveAt');
}

export async function touchSession(
  db: IDBPDatabase<PolychromeDBSchema>,
  id: SessionId,
): Promise<void> {
  const tx = db.transaction('sessions', 'readwrite');
  const store = tx.objectStore('sessions');
  const record = await store.get(id);
  if (record === undefined) {
    await tx.done;
    log.warn('touchSession: session not found', id);
    return;
  }
  record.lastActiveAt = Date.now();
  await store.put(record);
  await tx.done;
  log.debug('touchSession', id);
}

export async function deleteSession(
  db: IDBPDatabase<PolychromeDBSchema>,
  id: SessionId,
): Promise<void> {
  await db.delete('sessions', id);
  log.debug('deleteSession', id);
}
