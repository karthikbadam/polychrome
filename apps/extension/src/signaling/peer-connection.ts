/**
 * signaling/peer-connection.ts
 *
 * Wraps a single RTCPeerConnection between us and one remote peer.
 * Manages two RTCDataChannels:
 *   - `ops`    (reliable, ordered - default datachannel options)
 *   - `cursor` (unreliable, unordered - { ordered: false, maxRetransmits: 0 })
 *
 * SDP offer/answer and ICE candidate exchange are routed through the
 * SignalingAdapter.  This class does NOT call the adapter's `join/leave`
 * methods; that is MeshManager's responsibility.
 *
 * Connection lifecycle:
 *   1. Caller creates PeerConnection, calls start(isInitiator).
 *   2. If isInitiator, creates offer and sends via onSend.
 *   3. Remote sends answer/ICE; caller feeds them via handleSignal().
 *   4. Once ICE is 'connected', both channels open.
 *   5. We send a hello envelope (proto version), wait for theirs.
 *   6. onReady fires; MeshManager calls onPeerJoin.
 *   7. close() tears everything down cleanly.
 *
 * For unit tests, pass a `__rtcFactory` that returns a mock RTCPeerConnection.
 * Real WebRTC (E2E) is verified in Track Z.
 */

import type { ActorId, CursorMovePayload, Envelope } from '@polychrome/protocol';
import { PROTOCOL_VERSION, envelope, makeLogger } from '@polychrome/protocol';

import type { AdapterSignalingMessage } from './adapter.js';

const log = makeLogger('mesh:peer');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Congestion threshold: drop cursor if buffered amount exceeds this. */
const CURSOR_BUFFER_THRESHOLD = 64 * 1024; // 64KB

/** Wait this many ms for ICE self-heal before retrying. */
const ICE_DISCONNECT_HEAL_MS = 5_000;

export type RTCFactory = (config: RTCConfiguration) => RTCPeerConnection;

export interface PeerConnectionOptions {
  remoteActorId:  ActorId;
  iceServers:     RTCIceServer[];
  /** Called when we need to send a signaling message to the remote peer. */
  onSend:         (msg: AdapterSignalingMessage) => Promise<void>;
  /** Called when both sides have exchanged hellos and data channels are open. */
  onReady:        () => void;
  /** Called when an op-channel envelope arrives. */
  onOpEnvelope:   (env: Envelope) => void;
  /** Called when a cursor-channel envelope arrives. */
  onCursor:       (payload: CursorMovePayload) => void;
  /** Called when the peer disconnects / connection fails permanently. */
  onClose:        () => void;
  /** Inject a mock RTCPeerConnection constructor for unit tests. */
  __rtcFactory?:  RTCFactory;
}

// ---------------------------------------------------------------------------
// PeerConnection
// ---------------------------------------------------------------------------

export class PeerConnection {
  private pc: RTCPeerConnection;
  private opsChannel:    RTCDataChannel | null = null;
  private cursorChannel: RTCDataChannel | null = null;

  private _ready   = false;
  private _closed  = false;
  private _helloDone   = false; // we sent hello
  private _helloPeerDone = false; // peer sent hello

  private _healTimer: ReturnType<typeof setTimeout> | null = null;
  private _iceCandidateQueue: RTCIceCandidateInit[] = [];
  private _remoteDescSet = false;

  readonly remoteActorId: ActorId;
  private readonly opts: PeerConnectionOptions;

  constructor(opts: PeerConnectionOptions) {
    this.opts = opts;
    this.remoteActorId = opts.remoteActorId;

    const factory = opts.__rtcFactory ?? ((cfg) => new RTCPeerConnection(cfg));
    this.pc = factory({ iceServers: opts.iceServers });

    this._wirePC();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Start the handshake.
   * If `isInitiator`, we create an offer; otherwise we wait for an incoming
   * offer to be fed via `handleSignal`.
   */
  async start(isInitiator: boolean): Promise<void> {
    if (isInitiator) {
      log.debug('Creating offer for', this.remoteActorId);

      // Create data channels before the offer so they appear in the SDP.
      this._createDataChannels();

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      await this.opts.onSend({
        type: 'offer',
        sdp: JSON.stringify(this.pc.localDescription),
      });
    }
    // Non-initiator waits for the offer via handleSignal.
  }

  /**
   * Feed an incoming signaling message from the remote peer.
   */
  async handleSignal(msg: AdapterSignalingMessage): Promise<void> {
    if (this._closed) return;

    switch (msg.type) {
      case 'offer': {
        const desc = JSON.parse(msg.sdp) as RTCSessionDescriptionInit;
        await this.pc.setRemoteDescription(new RTCSessionDescription(desc));
        this._remoteDescSet = true;
        await this._drainIceCandidateQueue();

        // Non-initiator creates data channels on receiving offer.
        this._createDataChannels();

        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await this.opts.onSend({
          type: 'answer',
          sdp: JSON.stringify(this.pc.localDescription),
        });
        break;
      }

      case 'answer': {
        const desc = JSON.parse(msg.sdp) as RTCSessionDescriptionInit;
        await this.pc.setRemoteDescription(new RTCSessionDescription(desc));
        this._remoteDescSet = true;
        await this._drainIceCandidateQueue();
        break;
      }

      case 'ice': {
        if (this._remoteDescSet) {
          await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } else {
          this._iceCandidateQueue.push(msg.candidate);
        }
        break;
      }

      case 'hello':
        // Hello at signaling layer (before data channels are open) - ignore.
        // The proper hello flows over the ops data channel.
        break;

      case 'bye':
        log.info('Received bye from', this.remoteActorId, msg.reason);
        this._handleClose();
        break;

      default: {
        const _exhaustive: never = msg;
        log.warn('Unknown signaling message type', _exhaustive);
      }
    }
  }

  /** Send an op-channel envelope to this peer. */
  sendOp(env: Envelope): void {
    if (!this._ready || !this.opsChannel || this.opsChannel.readyState !== 'open') {
      log.warn('sendOp: channel not ready for', this.remoteActorId);
      return;
    }
    this.opsChannel.send(JSON.stringify(env));
  }

  /** Send cursor payload, subject to congestion check. */
  sendCursorRaw(payload: CursorMovePayload): void {
    if (
      !this._ready ||
      !this.cursorChannel ||
      this.cursorChannel.readyState !== 'open'
    ) return;

    if (this.cursorChannel.bufferedAmount > CURSOR_BUFFER_THRESHOLD) {
      // Drop due to congestion
      return;
    }

    this.cursorChannel.send(JSON.stringify(envelope.wrapCursor(payload)));
  }

  /** Close the connection gracefully. */
  close(): void {
    if (this._closed) return;
    this._closed = true;

    if (this._healTimer !== null) {
      clearTimeout(this._healTimer);
      this._healTimer = null;
    }

    // Send bye over signaling
    void this.opts.onSend({ type: 'bye', reason: 'close' }).catch(() => {/* ignore */});

    this.opsChannel?.close();
    this.cursorChannel?.close();
    this.pc.close();
    log.info('PeerConnection closed for', this.remoteActorId);
  }

  get isReady(): boolean { return this._ready; }
  get isClosed(): boolean { return this._closed; }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _wirePC(): void {
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        void this.opts.onSend({ type: 'ice', candidate: candidate.toJSON() });
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;
      log.debug('ICE state', state, 'for', this.remoteActorId);

      if (state === 'disconnected') {
        // Wait 5s for self-heal before giving up
        this._healTimer = setTimeout(() => {
          if (this.pc.iceConnectionState === 'disconnected' && !this._closed) {
            log.warn('ICE self-heal timed out for', this.remoteActorId);
            this._handleClose();
          }
        }, ICE_DISCONNECT_HEAL_MS);
      } else {
        if (this._healTimer !== null) {
          clearTimeout(this._healTimer);
          this._healTimer = null;
        }
      }

      if (state === 'failed' || state === 'closed') {
        this._handleClose();
      }
    };

    // For non-initiators, the remote peer may open the data channels.
    this.pc.ondatachannel = (ev) => {
      this._wireDataChannel(ev.channel);
    };
  }

  private _createDataChannels(): void {
    if (this.opsChannel) return; // Already created

    this.opsChannel = this.pc.createDataChannel('ops');
    this.cursorChannel = this.pc.createDataChannel('cursor', {
      ordered: false,
      maxRetransmits: 0,
    });

    this._wireDataChannel(this.opsChannel);
    this._wireDataChannel(this.cursorChannel);
  }

  private _wireDataChannel(ch: RTCDataChannel): void {
    if (ch.label === 'ops') {
      this.opsChannel = ch;
      ch.onopen = () => {
        log.debug('ops channel open for', this.remoteActorId);
        this._checkReady();
      };
      ch.onmessage = (ev) => {
        this._handleOpsMessage(ev.data as string);
      };
    } else if (ch.label === 'cursor') {
      this.cursorChannel = ch;
      ch.onopen = () => {
        log.debug('cursor channel open for', this.remoteActorId);
        this._checkReady();
      };
      ch.onmessage = (ev) => {
        this._handleCursorMessage(ev.data as string);
      };
    }

    ch.onerror = (ev) => {
      log.warn('DataChannel error on', ch.label, 'for', this.remoteActorId, ev);
    };

    ch.onclose = () => {
      log.debug('DataChannel closed:', ch.label, 'for', this.remoteActorId);
    };
  }

  private _checkReady(): void {
    if (
      this.opsChannel?.readyState === 'open' &&
      this.cursorChannel?.readyState === 'open' &&
      !this._helloDone
    ) {
      this._helloDone = true;
      this._sendHello();
    }
  }

  private _sendHello(): void {
    const helloEnv = envelope.wrapHello(this.opts.remoteActorId);
    // Slightly unconventional: we use wrapHello but the body is just { actorId }
    // per the protocol envelope; we repurpose it as our own hello.
    this.opsChannel?.send(JSON.stringify({ v: 1, type: 'hello', body: { proto: PROTOCOL_VERSION } }));
    log.debug('Sent hello to', this.remoteActorId, helloEnv);
  }

  private _handleOpsMessage(raw: string): void {
    let env: Envelope;
    try {
      env = JSON.parse(raw) as Envelope;
    } catch (e) {
      log.warn('Failed to parse ops message from', this.remoteActorId, e);
      return;
    }

    if (env.type === 'hello') {
      if (!this._helloPeerDone) {
        this._helloPeerDone = true;
        log.debug('Received hello from', this.remoteActorId);
        this._maybeFireReady();
      }
      return;
    }

    if (!this._ready) {
      log.warn('Received op before ready from', this.remoteActorId, env.type);
      return;
    }

    this.opts.onOpEnvelope(env);
  }

  private _handleCursorMessage(raw: string): void {
    let env: Envelope;
    try {
      env = JSON.parse(raw) as Envelope;
    } catch (e) {
      log.warn('Failed to parse cursor message from', this.remoteActorId, e);
      return;
    }

    if (env.type !== 'cursor') {
      log.warn('Unexpected envelope type on cursor channel', env.type);
      return;
    }

    this.opts.onCursor(env.body as CursorMovePayload);
  }

  private _maybeFireReady(): void {
    if (this._helloDone && this._helloPeerDone && !this._ready && !this._closed) {
      this._ready = true;
      log.info('Peer ready:', this.remoteActorId);
      this.opts.onReady();
    }
  }

  private _handleClose(): void {
    if (this._closed) return;
    this._closed = true;
    this._ready = false;
    this.pc.close();
    this.opts.onClose();
    log.info('PeerConnection closed (internal) for', this.remoteActorId);
  }

  private async _drainIceCandidateQueue(): Promise<void> {
    for (const c of this._iceCandidateQueue) {
      await this.pc.addIceCandidate(new RTCIceCandidate(c));
    }
    this._iceCandidateQueue = [];
  }
}
