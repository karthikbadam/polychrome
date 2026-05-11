/**
 * signaling/adapter.ts - SignalingAdapter interface
 *
 * All signaling backends must implement this contract. The adapter is
 * responsible only for rendezvous / SDP+ICE relay; it never touches
 * RTCPeerConnection itself.
 */

import type { ActorId, SessionId } from '@polychrome/protocol';

// ---------------------------------------------------------------------------
// Local signaling message shape (adapter-level, NOT the wire Envelope)
// ---------------------------------------------------------------------------

/**
 * Messages exchanged through the signaling channel to set up WebRTC.
 * All ICE/SDP values are serialised with JSON.stringify; do not pre-parse.
 */
export type AdapterSignalingMessage =
  | { type: 'offer';   sdp: string }
  | { type: 'answer';  sdp: string }
  | { type: 'ice';     candidate: RTCIceCandidateInit }
  | { type: 'hello';   proto: number }
  | { type: 'bye';     reason?: string };

/** Function returned by `onMessage` / `onPeerJoin` to cancel the subscription. */
export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// SignalingAdapter interface
// ---------------------------------------------------------------------------

export interface SignalingAdapter {
  /**
   * Connect to the rendezvous server and announce presence in `sessionId`
   * as `actorId`.  Resolves once the adapter is ready to send/receive.
   */
  join(sessionId: SessionId, actorId: ActorId): Promise<void>;

  /**
   * Send a signaling message to a specific remote peer.
   * If the remote peer is not yet present the message may be queued or
   * dropped depending on the backend.
   */
  sendTo(target: ActorId, msg: AdapterSignalingMessage): Promise<void>;

  /**
   * Subscribe to incoming signaling messages from any remote peer.
   * Returns an unsubscribe function.
   */
  onMessage(cb: (from: ActorId, msg: AdapterSignalingMessage) => void): Unsubscribe;

  /**
   * Called by the mesh when a new remote peer announces itself.
   * The adapter fires this when it receives a "peer joined" event from the
   * rendezvous (e.g. a PeerJS `connection` before the WebRTC handshake).
   * Returns an unsubscribe function.
   */
  onPeerJoin(cb: (actorId: ActorId) => void): Unsubscribe;

  /**
   * Called by the mesh when a remote peer leaves / disconnects.
   * Returns an unsubscribe function.
   */
  onPeerLeave(cb: (actorId: ActorId) => void): Unsubscribe;

  /**
   * Disconnect from the rendezvous and release all resources.
   */
  leave(): Promise<void>;
}
