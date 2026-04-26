/**
 * peers.ts — local cache of recent peers' display info.
 */

import { makeLogger } from '@polychrome/protocol';
import type { ActorId } from '@polychrome/protocol';
import type { IDBPDatabase } from 'idb';
import type { PolychromeDBSchema } from './db.js';
import type { PeerRecord } from './types.js';

const log = makeLogger('storage:peers');

/**
 * Upsert a peer record, updating `lastSeenAt` to now.
 */
export async function touchPeer(
  db: IDBPDatabase<PolychromeDBSchema>,
  record: Omit<PeerRecord, 'lastSeenAt'> & { lastSeenAt?: number },
): Promise<void> {
  const stored: PeerRecord = {
    ...record,
    lastSeenAt: record.lastSeenAt ?? Date.now(),
  };
  await db.put('peers', stored);
  log.debug('touchPeer', record.actorId);
}

export async function getPeer(
  db: IDBPDatabase<PolychromeDBSchema>,
  actorId: ActorId,
): Promise<PeerRecord | null> {
  const record = await db.get('peers', actorId);
  return record ?? null;
}

export async function listPeers(
  db: IDBPDatabase<PolychromeDBSchema>,
): Promise<PeerRecord[]> {
  return db.getAll('peers');
}

export async function deletePeer(
  db: IDBPDatabase<PolychromeDBSchema>,
  actorId: ActorId,
): Promise<void> {
  await db.delete('peers', actorId);
  log.debug('deletePeer', actorId);
}
