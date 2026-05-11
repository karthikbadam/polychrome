/**
 * import.ts - Import a .polychrome.zip, creating a new session.
 *
 * Validates the manifest version, assigns a new sessionId, and writes
 * everything in a single IDB transaction (chunked if > 50 MB).
 */

import { makeLogger, newSessionId } from '@polychrome/protocol';
import type { Operation, SessionId, Seq } from '@polychrome/protocol';
import { unzipSync } from 'fflate';
import type { IDBPDatabase } from 'idb';
import type { PolychromeDBSchema } from './db.js';
import type {
  ExportManifest,
  SessionRecord,
  SnapshotRecord,
  PeerRecord,
} from './types.js';

const log = makeLogger('storage:import');

const dec = new TextDecoder();

/** Maximum bytes to write in a single IDB transaction before chunking. */
const CHUNK_THRESHOLD = 50 * 1024 * 1024; // 50 MB

export async function importSession(
  db: IDBPDatabase<PolychromeDBSchema>,
  blob: Blob,
): Promise<SessionId> {
  const arrayBuffer = await blob.arrayBuffer();
  const zipData = new Uint8Array(arrayBuffer);
  const unzipped = unzipSync(zipData);

  // ---- parse manifest ----
  const manifestFile = unzipped['manifest.json'];
  if (manifestFile === undefined) {
    throw new Error('importSession: missing manifest.json');
  }
  const manifest = JSON.parse(dec.decode(manifestFile)) as ExportManifest;
  if (manifest.version !== 1 || manifest.schema !== 1) {
    throw new Error(`importSession: unsupported manifest version ${manifest.version}`);
  }

  // ---- parse session ----
  const sessionFile = unzipped['session.json'];
  if (sessionFile === undefined) {
    throw new Error('importSession: missing session.json');
  }
  const originalSession = JSON.parse(dec.decode(sessionFile)) as SessionRecord;

  // Allocate a fresh sessionId so the import doesn't collide with the original
  const newId = newSessionId();
  const importedSession: SessionRecord = {
    ...originalSession,
    sessionId: newId,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };

  // ---- parse ops ----
  const opsFile = unzipped['ops.jsonl'];
  const ops: Operation[] = [];
  if (opsFile !== undefined) {
    const lines = dec.decode(opsFile).split('\n').filter(l => l.trim().length > 0);
    for (const line of lines) {
      const op = JSON.parse(line) as Operation;
      // Remap sessionId
      ops.push({ ...op, sessionId: newId });
    }
  }

  // ---- parse snapshots ----
  const snapshotEntries: Array<{ filename: string; data: Uint8Array }> = [];
  for (const [path, data] of Object.entries(unzipped)) {
    if (path.startsWith('snapshots/') && path.endsWith('.json.gz')) {
      snapshotEntries.push({ filename: path.replace('snapshots/', ''), data });
    }
  }

  // ---- parse peers ----
  const peersFile = unzipped['peers.json'];
  const peers: PeerRecord[] = peersFile !== undefined
    ? JSON.parse(dec.decode(peersFile)) as PeerRecord[]
    : [];

  // ---- estimate total size for chunking decision ----
  const totalOpBytes = opsFile?.byteLength ?? 0;

  if (totalOpBytes <= CHUNK_THRESHOLD) {
    // Single transaction
    await writeSingleTransaction(db, importedSession, newId, ops, snapshotEntries, peers);
  } else {
    // Chunked writes: session + peers first, then ops in chunks
    await writeChunked(db, importedSession, newId, ops, snapshotEntries, peers);
  }

  log.info('importSession newId=%s ops=%d snapshots=%d', newId, ops.length, snapshotEntries.length);
  return newId;
}

async function writeSingleTransaction(
  db: IDBPDatabase<PolychromeDBSchema>,
  session: SessionRecord,
  sessionId: SessionId,
  ops: Operation[],
  snapshotEntries: Array<{ filename: string; data: Uint8Array }>,
  peers: PeerRecord[],
): Promise<void> {
  const tx = db.transaction(['sessions', 'op_log', 'snapshots', 'peers'], 'readwrite');

  tx.objectStore('sessions').put(session);

  const opStore = tx.objectStore('op_log');
  for (const op of ops) {
    opStore.put({ sessionId: op.sessionId, seq: op.seq, op });
  }

  const snapStore = tx.objectStore('snapshots');
  for (const { filename, data } of snapshotEntries) {
    const snap = parseSnapshotFilename(filename, sessionId, data);
    if (snap !== null) {
      snapStore.put(snap);
    }
  }

  const peerStore = tx.objectStore('peers');
  for (const peer of peers) {
    peerStore.put(peer);
  }

  await tx.done;
}

async function writeChunked(
  db: IDBPDatabase<PolychromeDBSchema>,
  session: SessionRecord,
  sessionId: SessionId,
  ops: Operation[],
  snapshotEntries: Array<{ filename: string; data: Uint8Array }>,
  peers: PeerRecord[],
): Promise<void> {
  // Write session and peers
  {
    const tx = db.transaction(['sessions', 'peers'], 'readwrite');
    tx.objectStore('sessions').put(session);
    for (const peer of peers) {
      tx.objectStore('peers').put(peer);
    }
    await tx.done;
  }

  // Write snapshots
  if (snapshotEntries.length > 0) {
    const tx = db.transaction('snapshots', 'readwrite');
    const store = tx.objectStore('snapshots');
    for (const { filename, data } of snapshotEntries) {
      const snap = parseSnapshotFilename(filename, sessionId, data);
      if (snap !== null) {
        store.put(snap);
      }
    }
    await tx.done;
  }

  // Write ops in chunks of ~10k
  const CHUNK_SIZE = 10_000;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const chunk = ops.slice(i, i + CHUNK_SIZE);
    const tx = db.transaction('op_log', 'readwrite');
    const store = tx.objectStore('op_log');
    for (const op of chunk) {
      store.put({ sessionId: op.sessionId, seq: op.seq, op });
    }
    await tx.done;
  }
}

/**
 * Parse snapshot filename like "rrweb-42.json.gz" or "state-42.json.gz"
 * into a SnapshotRecord with the remapped sessionId.
 */
function parseSnapshotFilename(
  filename: string,
  sessionId: SessionId,
  data: Uint8Array,
): SnapshotRecord | null {
  // "rrweb-<seq>.json.gz" or "state-<seq>.json.gz"
  const match = /^(rrweb|state)-(\d+)\.json\.gz$/.exec(filename);
  if (match === null) {
    return null;
  }
  const type = match[1] as 'rrweb' | 'state';
  const seq = parseInt(match[2]!, 10) as Seq;
  return {
    sessionId,
    seq,
    type,
    data: data.buffer,
    size: data.byteLength,
    createdAt: Date.now(),
  };
}
