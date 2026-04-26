/**
 * @polychrome/protocol — messages.ts
 *
 * Message type discriminated unions for:
 *   - SW ↔ content script (chrome.runtime.connect)
 *   - page-bridge ↔ content script (window.postMessage)
 *   - Network envelope (WebRTC data channel)
 *   - WebRTC signaling
 */

import type {
  ActorId,
  IdentityRecord,
  Operation,
  Seq,
  SessionId,
  SnapshotRecord,
} from './types.js';

// ---------------------------------------------------------------------------
// SW → content script
// ---------------------------------------------------------------------------

export type SwToContent =
  | { type: 'session/joined'; sessionId: SessionId; actorId: ActorId }
  | { type: 'session/left' }
  | { type: 'op/dispatch'; op: Operation }
  | { type: 'op/batch'; ops: Operation[] }
  | { type: 'cursor/peer'; actorId: ActorId; x: number; y: number; color: string }
  | { type: 'replay/start'; snapshot: SnapshotRecord }
  | { type: 'replay/end' }
  | { type: 'snapshot/please' }
  | { type: 'identity/update'; identity: IdentityRecord };

// ---------------------------------------------------------------------------
// content script → SW
// ---------------------------------------------------------------------------

export type ContentToSw =
  | { type: 'op/local'; op: Omit<Operation, 'seq' | 'sessionId' | 'actorId' | 'clientSeq' | 'parentSeq' | 'ts'> }
  | { type: 'cursor/local'; x: number; y: number }
  | { type: 'snapshot/rrweb'; events: unknown[]; capturedAtSeq: Seq }
  | { type: 'page/ready'; url: string; title: string }
  | { type: 'page/adapter'; adapterId: string; capabilities: string[] };

// ---------------------------------------------------------------------------
// page-bridge ↔ content script (window.postMessage)
// ---------------------------------------------------------------------------

export type BridgeMsg =
  | { type: 'page/share';       key: string; value: unknown }
  | { type: 'page/list_op';     listId: string; op: 'insert' | 'delete'; index: number; value?: unknown }
  | { type: 'page/checkpoint';  label: string }
  | { type: 'page/subscribe';   key: string }
  | { type: 'page/unsubscribe'; key: string }
  | { type: 'content/event';    eventName: string; data: unknown };

export interface BridgeEnvelope {
  __polychrome: true;
  v: 1;
  body: BridgeMsg;
}

// ---------------------------------------------------------------------------
// Network envelope (WebRTC data channel)
// ---------------------------------------------------------------------------

export type EnvelopeType =
  | 'op'
  | 'op_batch'
  | 'cursor'
  | 'sync_request'
  | 'sync_response'
  | 'leader_claim'
  | 'leader_grant'
  | 'hello'
  | 'incompatible';

export interface Envelope {
  v:    1;
  type: EnvelopeType;
  body: unknown;
}

// ---------------------------------------------------------------------------
// WebRTC signaling message
// ---------------------------------------------------------------------------

export type SignalingMessageKind =
  | 'offer'
  | 'answer'
  | 'ice-candidate'
  | 'join'
  | 'leave'
  | 'peer-list';

export interface SignalingMessage {
  kind:      SignalingMessageKind;
  sessionId: SessionId;
  from:      ActorId;
  to?:       ActorId;       // undefined = broadcast
  payload:   unknown;
}
