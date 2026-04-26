/**
 * export.ts — Export a session as a .polychrome.zip Blob.
 *
 * ZIP layout:
 *   manifest.json
 *   session.json
 *   ops.jsonl
 *   snapshots/rrweb-<seq>.json.gz
 *   snapshots/state-<seq>.json.gz
 *   peers.json
 */

import { makeLogger } from '@polychrome/protocol';
import type { SessionId } from '@polychrome/protocol';
import { zipSync, type Zippable } from 'fflate';
import type { IDBPDatabase } from 'idb';
import type { PolychromeDBSchema } from './db.js';
import { getOps, lastSeq } from './op-log.js';
import { listPeers } from './peers.js';
import { getSession } from './sessions.js';
import { listSnapshots } from './snapshots.js';
import type { ExportManifest } from './types.js';

const log = makeLogger('storage:export');

const enc = new TextEncoder();

export async function exportSession(
  db: IDBPDatabase<PolychromeDBSchema>,
  sessionId: SessionId,
): Promise<Blob> {
  const session = await getSession(db, sessionId);
  if (session === null) {
    throw new Error(`exportSession: session not found: ${sessionId}`);
  }

  const currentLastSeq = await lastSeq(db, sessionId);

  const manifest: ExportManifest = {
    version: 1,
    sessionId,
    createdAt: Date.now(),
    lastSeq: currentLastSeq,
    schema: 1,
  };

  // Build ops.jsonl by streaming the cursor
  const opLines: string[] = [];
  for await (const op of getOps(db, sessionId, 0 as never, currentLastSeq as never)) {
    opLines.push(JSON.stringify(op));
  }
  const opsJsonl = opLines.join('\n');

  // Snapshots — data is already gzipped as stored
  const snapshots = await listSnapshots(db, sessionId);
  const snapshotFiles: Record<string, Uint8Array> = {};
  for (const snap of snapshots) {
    const filename = `${snap.type}-${snap.seq}.json.gz`;
    snapshotFiles[filename] = new Uint8Array(snap.data);
  }

  const peers = await listPeers(db);

  // Assemble the zip
  const files: Zippable = {
    'manifest.json': enc.encode(JSON.stringify(manifest, null, 2)),
    'session.json': enc.encode(JSON.stringify(session, null, 2)),
    'ops.jsonl': enc.encode(opsJsonl),
    'peers.json': enc.encode(JSON.stringify(peers, null, 2)),
  };

  // Add snapshot files under snapshots/
  for (const [name, data] of Object.entries(snapshotFiles)) {
    // Files are already gzipped — store with no extra compression
    files[`snapshots/${name}`] = [data, { level: 0 }];
  }

  const zipBytes = zipSync(files);
  log.info('exportSession sessionId=%s size=%d ops=%d snapshots=%d',
    sessionId, zipBytes.byteLength, opLines.length, snapshots.length);

  return new Blob([zipBytes], { type: 'application/zip' });
}
