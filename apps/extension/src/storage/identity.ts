/**
 * identity.ts - get/update the single 'self' identity row.
 */

import { makeLogger } from '@polychrome/protocol';
import type { IDBPDatabase } from 'idb';
import type { PolychromeDBSchema } from './db.js';
import type { IdentityRecord } from './types.js';

const log = makeLogger('storage:identity');

export async function getIdentity(
  db: IDBPDatabase<PolychromeDBSchema>,
): Promise<IdentityRecord | null> {
  const record = await db.get('identity', 'self');
  return record ?? null;
}

export async function updateIdentity(
  db: IDBPDatabase<PolychromeDBSchema>,
  patch: Partial<Omit<IdentityRecord, 'id'>>,
): Promise<void> {
  const tx = db.transaction('identity', 'readwrite');
  const store = tx.objectStore('identity');
  const existing = await store.get('self');
  if (existing === undefined) {
    // Should not happen in normal operation; log and bail
    log.warn('updateIdentity: no identity row found');
    await tx.done;
    return;
  }
  const updated: IdentityRecord = { ...existing, ...patch };
  await store.put(updated);
  await tx.done;
  log.debug('updateIdentity', patch);
}
