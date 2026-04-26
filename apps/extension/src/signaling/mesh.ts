/**
 * signaling/mesh.ts - MeshManager
 *
 * Orchestrates a full-mesh WebRTC session:
 *   - Joins the signaling adapter.
 *   - Creates a PeerConnection for each remote actor.
 *   - Exposes broadcast(), sendTo(), sendCursor() to higher layers.
 *   - Fires onPeerJoin / onPeerLeave / onOpEnvelope / onCursor callbacks.
 *
 * Cursor moves are coalesced at ≤30Hz (via throttle.ts) and additionally
 * dropped per-peer when the cursor data channel is congested (handled in
 * PeerConnection.sendCursorRaw).
 *
 * Track H (background SW) is responsible for wiring MeshManager to storage
 * and the OT engine.  Do not import from src/storage/ here.
 *
 * RTCPeerConnection in MV3 service workers:
 *   See README.md in this folder.  The code is written assuming a DOM-bearing
 *   context; the __rtcFactory option lets tests inject mocks and Track H can
 *   inject an offscreen-document-backed factory if needed.
 */

import type { ActorId, CursorMovePayload, Envelope, SessionId } from '@polychrome/protocol';
import { makeLogger } from '@polychrome/protocol';

import type { SignalingAdapter, Unsubscribe } from './adapter.js';
import { PeerConnection, type PeerConnectionOptions, type RTCFactory } from './peer-connection.js';
import { createCursorThrottle } from './throttle.js';

const log = makeLogger('mesh');

/** Maximum peers before switching to star topology (not implemented in v1). */
const MESH_MAX_PEERS = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MeshManagerOptions {
  adapter:       SignalingAdapter;
  iceServers?:   RTCIceServer[];
  onPeerJoin:    (actorId: ActorId) => void;
  onPeerLeave:   (actorId: ActorId) => void;
  onOpEnvelope:  (from: ActorId, env: Envelope) => void;
  onCursor:      (from: ActorId, payload: CursorMovePayload) => void;
  /**
   * Inject a mock RTCPeerConnection constructor for unit tests.
   * Do NOT pass this in production.
   */
  __rtcFactory?: RTCFactory;
}

// ---------------------------------------------------------------------------
// Default ICE servers (STUN only; TURN credentials come from Options)
// ---------------------------------------------------------------------------

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// ---------------------------------------------------------------------------
// MeshManager
// ---------------------------------------------------------------------------

export class MeshManager {
  private readonly adapter:      SignalingAdapter;
  private readonly iceServers:   RTCIceServer[];
  private readonly callbacks:    Omit<MeshManagerOptions, 'adapter' | 'iceServers' | '__rtcFactory'>;
  private readonly rtcFactory:   RTCFactory | undefined;

  /** Currently active PeerConnections keyed by remote actorId. */
  private connections = new Map<ActorId, PeerConnection>();

  private sessionId: SessionId | null = null;
  private actorId:   ActorId   | null = null;
  private started    = false;
  private stopped    = false;

  /** Cursor coalescer - shared across all peers. */
  private cursorThrottle: ReturnType<typeof createCursorThrottle<CursorMovePayload>>;

  /** Signaling adapter unsubscribe handles. */
  private unsubs: Unsubscribe[] = [];

  constructor(opts: MeshManagerOptions) {
    this.adapter    = opts.adapter;
    this.iceServers = opts.iceServers ?? DEFAULT_ICE_SERVERS;
    this.rtcFactory = opts.__rtcFactory;
    this.callbacks  = {
      onPeerJoin:   opts.onPeerJoin,
      onPeerLeave:  opts.onPeerLeave,
      onOpEnvelope: opts.onOpEnvelope,
      onCursor:     opts.onCursor,
    };

    this.cursorThrottle = createCursorThrottle((payload) => {
      this._broadcastCursorRaw(payload);
    });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Join the session.  Idempotent - safe to call once.
   */
  async start(sessionId: SessionId, actorId: ActorId): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.sessionId = sessionId;
    this.actorId   = actorId;

    log.info('MeshManager starting', sessionId, actorId);

    // Wire adapter events before joining so we don't miss any.
    this.unsubs.push(
      this.adapter.onPeerJoin((remoteId) => this._onAdapterPeerJoin(remoteId)),
      this.adapter.onPeerLeave((remoteId) => this._onAdapterPeerLeave(remoteId)),
      this.adapter.onMessage((from, msg) => this._onAdapterMessage(from, msg)),
    );

    await this.adapter.join(sessionId, actorId);
    log.info('MeshManager joined', sessionId);
  }

  /**
   * Leave the session and close all connections.
   */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    log.info('MeshManager stopping');

    // Cancel cursor throttle
    this.cursorThrottle.cancel();

    // Close all peer connections
    for (const pc of this.connections.values()) {
      pc.close();
    }
    this.connections.clear();

    // Unsubscribe adapter listeners
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];

    await this.adapter.leave();
    log.info('MeshManager stopped');
  }

  // ---------------------------------------------------------------------------
  // Public send API
  // ---------------------------------------------------------------------------

  /**
   * Broadcast an op-channel envelope to ALL connected peers.
   */
  broadcast(env: Envelope): void {
    for (const pc of this.connections.values()) {
      if (pc.isReady) {
        pc.sendOp(env);
      }
    }
  }

  /**
   * Send an op-channel envelope to a SPECIFIC peer.
   */
  sendTo(actorId: ActorId, env: Envelope): void {
    const pc = this.connections.get(actorId);
    if (!pc?.isReady) {
      log.warn('sendTo: peer not ready', actorId);
      return;
    }
    pc.sendOp(env);
  }

  /**
   * Send a cursor update, throttled to ≤30Hz.
   * Internally calls _broadcastCursorRaw via the throttle coalescer.
   */
  sendCursor(payload: CursorMovePayload): void {
    this.cursorThrottle.schedule(payload);
  }

  /**
   * Returns the list of currently-ready peer actor IDs.
   */
  peers(): ActorId[] {
    return Array.from(this.connections.entries())
      .filter(([, pc]) => pc.isReady)
      .map(([id]) => id);
  }

  // ---------------------------------------------------------------------------
  // Private: adapter events
  // ---------------------------------------------------------------------------

  private _onAdapterPeerJoin(remoteId: ActorId): void {
    if (this.stopped) return;
    if (this.connections.has(remoteId)) {
      log.debug('Already have connection to', remoteId, '- skipping');
      return;
    }

    if (this.connections.size >= MESH_MAX_PEERS) {
      log.warn('Mesh cap reached; not connecting to', remoteId);
      return;
    }

    log.info('New peer joined', remoteId, '- creating offer');
    const pc = this._createPeerConnection(remoteId);
    this.connections.set(remoteId, pc);

    // We are the initiator because we received the join event.
    void pc.start(true);
  }

  private _onAdapterPeerLeave(remoteId: ActorId): void {
    const pc = this.connections.get(remoteId);
    if (pc) {
      pc.close();
      this.connections.delete(remoteId);
      this.callbacks.onPeerLeave(remoteId);
      log.info('Peer left', remoteId);
    }
  }

  private _onAdapterMessage(
    from: ActorId,
    msg: import('./adapter.js').AdapterSignalingMessage,
  ): void {
    if (this.stopped) return;

    // If we don't have a connection yet (we are the answerer), create one.
    if (!this.connections.has(from) && msg.type === 'offer') {
      log.info('Received offer from new peer', from, '- creating answer');
      const pc = this._createPeerConnection(from);
      this.connections.set(from, pc);
      // Non-initiator: start before handling the offer
      void pc.start(false).then(() => pc.handleSignal(msg));
      return;
    }

    const pc = this.connections.get(from);
    if (!pc) {
      log.warn('Received signal from unknown peer', from, msg.type);
      return;
    }

    void pc.handleSignal(msg);
  }

  // ---------------------------------------------------------------------------
  // Private: create PeerConnection
  // ---------------------------------------------------------------------------

  private _createPeerConnection(remoteId: ActorId): PeerConnection {
    const baseOpts: PeerConnectionOptions = {
      remoteActorId: remoteId,
      iceServers:    this.iceServers,

      onSend: async (msg) => {
        await this.adapter.sendTo(remoteId, msg);
      },

      onReady: () => {
        log.info('Peer ready', remoteId);
        this.callbacks.onPeerJoin(remoteId);
      },

      onOpEnvelope: (env) => {
        this.callbacks.onOpEnvelope(remoteId, env);
      },

      onCursor: (payload) => {
        this.callbacks.onCursor(remoteId, payload);
      },

      onClose: () => {
        const removed = this.connections.delete(remoteId);
        if (removed) {
          this.callbacks.onPeerLeave(remoteId);
        }
      },
    };

    if (this.rtcFactory !== undefined) {
      baseOpts.__rtcFactory = this.rtcFactory;
    }

    return new PeerConnection(baseOpts);
  }

  // ---------------------------------------------------------------------------
  // Private: cursor broadcast
  // ---------------------------------------------------------------------------

  private _broadcastCursorRaw(payload: CursorMovePayload): void {
    for (const pc of this.connections.values()) {
      if (pc.isReady) {
        pc.sendCursorRaw(payload);
      }
    }
  }
}
