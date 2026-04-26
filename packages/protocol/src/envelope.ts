/**
 * @polychrome/protocol — envelope.ts
 *
 * Helper functions that wrap protocol payloads into typed Envelope objects
 * for transmission over the WebRTC data channel.
 */

import type { Envelope } from './messages.js';
import type { ActorId, CursorMovePayload, Operation } from './types.js';

// ---------------------------------------------------------------------------
// Envelope wrappers
// ---------------------------------------------------------------------------

/**
 * Wrap a single Operation into an 'op' envelope.
 */
export function wrapOp(op: Operation): Envelope {
  return { v: 1, type: 'op', body: op };
}

/**
 * Wrap an array of Operations into an 'op_batch' envelope.
 */
export function wrapBatch(ops: Operation[]): Envelope {
  return { v: 1, type: 'op_batch', body: ops };
}

/**
 * Wrap a cursor position into a 'cursor' envelope.
 */
export function wrapCursor(payload: CursorMovePayload): Envelope {
  return { v: 1, type: 'cursor', body: payload };
}

/**
 * Wrap a 'hello' announcement from a connecting peer.
 *
 * @param actorId  The connecting peer's stable actor ID.
 */
export function wrapHello(actorId: ActorId): Envelope {
  return { v: 1, type: 'hello', body: { actorId } };
}

/**
 * Wrap a sync_request (ask a peer to send their op log).
 *
 * @param fromSeq  The requesting peer's last known seq; peer will send ops
 *                 with seq > fromSeq.
 */
export function wrapSyncRequest(fromSeq: number): Envelope {
  return { v: 1, type: 'sync_request', body: { fromSeq } };
}

/**
 * Wrap a sync_response (op batch sent in reply to a sync_request).
 */
export function wrapSyncResponse(ops: Operation[]): Envelope {
  return { v: 1, type: 'sync_response', body: ops };
}

/**
 * Wrap a leader_claim (peer announces itself as candidate leader).
 *
 * @param actorId  The claiming actor.
 * @param seq      The highest seq the claimant has seen.
 */
export function wrapLeaderClaim(actorId: ActorId, seq: number): Envelope {
  return { v: 1, type: 'leader_claim', body: { actorId, seq } };
}

/**
 * Wrap a leader_grant (existing leader hands off to a new leader).
 *
 * @param actorId  The new leader's actor ID.
 */
export function wrapLeaderGrant(actorId: ActorId): Envelope {
  return { v: 1, type: 'leader_grant', body: { actorId } };
}

/**
 * Wrap an incompatible-version refusal.
 *
 * @param ourVersion  The protocol version this peer is running.
 */
export function wrapIncompatible(ourVersion: number): Envelope {
  return { v: 1, type: 'incompatible', body: { version: ourVersion } };
}
