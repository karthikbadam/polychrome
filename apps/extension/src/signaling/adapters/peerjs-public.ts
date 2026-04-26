/**
 * signaling/adapters/peerjs-public.ts
 *
 * Signaling adapter that uses the public PeerJS server (0.peerjs.com) as the
 * rendezvous point.  PeerJS DataConnections carry our AdapterSignalingMessage
 * envelopes — the actual WebRTC PeerConnections are managed separately by
 * MeshManager / PeerConnection.
 *
 * The PeerJS peer ID is derived from a combination of sessionId and actorId so
 * that peers in the same session can find each other via the broker.
 * We concatenate them: `<sessionId>--<actorId>` (the double-dash is
 * a legal PeerJS ID separator that is unlikely to appear in either part).
 *
 * NOTE: PeerJS wraps its own RTCPeerConnection internally just for the
 * DataConnection used as a signaling channel here.  The mesh's RTCPeerConnections
 * are created separately by peer-connection.ts.
 */

import type { ActorId, SessionId } from '@polychrome/protocol';
import { makeLogger } from '@polychrome/protocol';

import { Peer } from 'peerjs';

import type { AdapterSignalingMessage, SignalingAdapter, Unsubscribe } from '../adapter.js';

const log = makeLogger('signaling:peerjs');

/** Encode a (sessionId, actorId) pair into a valid PeerJS peer ID. */
function encodePeerId(sessionId: SessionId, actorId: ActorId): string {
  // PeerJS IDs: alphanumeric, dash, underscore, max 60 chars.
  // sessionId is 6-char base32; actorId is UUIDv4 (36 chars with dashes).
  // Replace UUID dashes to avoid confusion with our separator.
  const safeActor = actorId.replace(/-/g, '_');
  return `pc_${sessionId}__${safeActor}`;
}

type MessageCallback = (from: ActorId, msg: AdapterSignalingMessage) => void;
type PeerJoinCallback = (actorId: ActorId) => void;
type PeerLeaveCallback = (actorId: ActorId) => void;

export class PeerJsPublicAdapter implements SignalingAdapter {
  private peer: Peer | null = null;
  private sessionId: SessionId | null = null;
  private actorId: ActorId | null = null;

  private messageCallbacks: Set<MessageCallback> = new Set();
  private peerJoinCallbacks: Set<PeerJoinCallback> = new Set();
  private peerLeaveCallbacks: Set<PeerLeaveCallback> = new Set();

  /**
   * Optional ICE server config forwarded to PeerJS so the DataConnections
   * used for signaling can traverse NAT.  Defaults to the PeerJS built-in.
   */
  constructor(private readonly iceServers?: RTCIceServer[]) {}

  async join(sessionId: SessionId, actorId: ActorId): Promise<void> {
    this.sessionId = sessionId;
    this.actorId = actorId;

    const peerId = encodePeerId(sessionId, actorId);

    return new Promise<void>((resolve, reject) => {
      const options = this.iceServers
        ? { config: { iceServers: this.iceServers } }
        : undefined;

      const peer = options ? new Peer(peerId, options) : new Peer(peerId);
      this.peer = peer;

      peer.on('open', (id) => {
        log.info('PeerJS open', id);
        resolve();
      });

      peer.on('error', (err) => {
        log.error('PeerJS error', err.type, err.message);
        // Only reject on join; afterwards errors are logged.
        reject(err);
      });

      // Incoming connections from remote peers act as a "peer joined" signal.
      peer.on('connection', (conn) => {
        const remoteActorId = this._decodeActorId(conn.peer);
        if (!remoteActorId) {
          log.warn('Received connection from unknown peer ID format', conn.peer);
          conn.close();
          return;
        }

        log.debug('Incoming peerjs connection from', remoteActorId);

        conn.on('open', () => {
          this._fireJoin(remoteActorId);
        });

        conn.on('data', (raw) => {
          this._handleData(remoteActorId, raw);
        });

        conn.on('close', () => {
          this._fireLeave(remoteActorId);
        });

        conn.on('error', (err) => {
          log.warn('DataConnection error from', remoteActorId, err.message);
        });
      });

      peer.on('disconnected', () => {
        log.warn('PeerJS disconnected from server');
      });

      peer.on('close', () => {
        log.info('PeerJS peer closed');
      });
    });
  }

  async sendTo(target: ActorId, msg: AdapterSignalingMessage): Promise<void> {
    if (!this.peer || !this.sessionId) {
      throw new Error('PeerJsPublicAdapter: not joined');
    }

    const targetPeerId = encodePeerId(this.sessionId, target);

    return new Promise<void>((resolve, reject) => {
      const conn = this.peer!.connect(targetPeerId, { serialization: 'json' });

      conn.on('open', () => {
        conn.send(msg);
        // We leave the connection open for potential future messages; the
        // 'connection' handler above will receive replies.
        resolve();
      });

      conn.on('error', (err) => {
        log.warn('sendTo DataConnection error to', target, err.message);
        reject(err);
      });
    });
  }

  onMessage(cb: MessageCallback): Unsubscribe {
    this.messageCallbacks.add(cb);
    return () => { this.messageCallbacks.delete(cb); };
  }

  onPeerJoin(cb: PeerJoinCallback): Unsubscribe {
    this.peerJoinCallbacks.add(cb);
    return () => { this.peerJoinCallbacks.delete(cb); };
  }

  onPeerLeave(cb: PeerLeaveCallback): Unsubscribe {
    this.peerLeaveCallbacks.add(cb);
    return () => { this.peerLeaveCallbacks.delete(cb); };
  }

  async leave(): Promise<void> {
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.messageCallbacks.clear();
    this.peerJoinCallbacks.clear();
    this.peerLeaveCallbacks.clear();
    this.sessionId = null;
    this.actorId = null;
    log.info('PeerJS adapter left');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _decodeActorId(peerJsId: string): ActorId | null {
    // Format: pc_<sessionId>__<safeActorId>
    const match = peerJsId.match(/^pc_[A-Z0-9]+__(.+)$/);
    if (!match || !match[1]) return null;
    // Reverse: underscores that were originally dashes in a UUID
    const restored = match[1].replace(/_/g, '-') as ActorId;
    return restored;
  }

  private _handleData(from: ActorId, raw: unknown): void {
    if (typeof raw !== 'object' || raw === null || !('type' in raw)) {
      log.warn('Received non-object signaling message from', from);
      return;
    }
    const msg = raw as AdapterSignalingMessage;
    for (const cb of this.messageCallbacks) {
      cb(from, msg);
    }
  }

  private _fireJoin(actorId: ActorId): void {
    for (const cb of this.peerJoinCallbacks) {
      cb(actorId);
    }
  }

  private _fireLeave(actorId: ActorId): void {
    for (const cb of this.peerLeaveCallbacks) {
      cb(actorId);
    }
  }
}
