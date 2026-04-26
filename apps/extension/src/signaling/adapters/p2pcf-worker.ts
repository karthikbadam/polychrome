/**
 * signaling/adapters/p2pcf-worker.ts
 *
 * Signaling adapter backed by a bring-your-own Cloudflare Worker that acts as
 * a lightweight WebSocket signaling relay.
 *
 * Expected Worker protocol (JSON over WebSocket):
 *
 *   Client → Server  { kind: 'join', sessionId, actorId }
 *   Server → Client  { kind: 'peer-list', peers: ActorId[] }
 *   Server → Client  { kind: 'peer-join', actorId }
 *   Server → Client  { kind: 'peer-leave', actorId }
 *   Client → Server  { kind: 'signal', to: ActorId, from: ActorId, msg: AdapterSignalingMessage }
 *   Server → Client  { kind: 'signal', from: ActorId, msg: AdapterSignalingMessage }
 *
 * If no `workerUrl` is provided the adapter throws "not-configured" on join(),
 * which allows the Options page to surface a configuration prompt.
 */

import type { ActorId, SessionId } from '@polychrome/protocol';
import { makeLogger } from '@polychrome/protocol';

import type { AdapterSignalingMessage, SignalingAdapter, Unsubscribe } from '../adapter.js';

const log = makeLogger('signaling:p2pcf');

type MessageCallback = (from: ActorId, msg: AdapterSignalingMessage) => void;
type PeerJoinCallback = (actorId: ActorId) => void;
type PeerLeaveCallback = (actorId: ActorId) => void;

/** Worker-level wire messages */
type WorkerMessage =
  | { kind: 'peer-list'; peers: ActorId[] }
  | { kind: 'peer-join'; actorId: ActorId }
  | { kind: 'peer-leave'; actorId: ActorId }
  | { kind: 'signal'; from: ActorId; msg: AdapterSignalingMessage };

export class P2pcfWorkerAdapter implements SignalingAdapter {
  private ws: WebSocket | null = null;
  private sessionId: SessionId | null = null;
  private actorId: ActorId | null = null;

  private messageCallbacks: Set<MessageCallback> = new Set();
  private peerJoinCallbacks: Set<PeerJoinCallback> = new Set();
  private peerLeaveCallbacks: Set<PeerLeaveCallback> = new Set();

  /**
   * @param workerUrl  Full URL of the Cloudflare Worker signaling endpoint,
   *                   e.g. "wss://polychrome-signal.yourname.workers.dev".
   *                   If omitted, join() will throw "not-configured".
   */
  constructor(private readonly workerUrl?: string) {}

  async join(sessionId: SessionId, actorId: ActorId): Promise<void> {
    if (!this.workerUrl) {
      throw new Error('P2pcfWorkerAdapter: not-configured — set Worker URL in Options');
    }

    this.sessionId = sessionId;
    this.actorId = actorId;

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.workerUrl!);
      this.ws = ws;

      ws.onopen = () => {
        log.info('P2PCF WebSocket open', this.workerUrl);
        ws.send(JSON.stringify({ kind: 'join', sessionId, actorId }));
        // Resolve immediately on connection; peer-list arrives asynchronously.
        resolve();
      };

      ws.onerror = (ev) => {
        log.error('P2PCF WebSocket error', ev);
        reject(new Error('P2pcfWorkerAdapter: WebSocket connection failed'));
      };

      ws.onclose = () => {
        log.warn('P2PCF WebSocket closed');
      };

      ws.onmessage = (ev) => {
        let parsed: WorkerMessage;
        try {
          parsed = JSON.parse(ev.data as string) as WorkerMessage;
        } catch {
          log.warn('P2PCF: failed to parse message', ev.data);
          return;
        }
        this._handleWorkerMessage(parsed);
      };
    });
  }

  async sendTo(target: ActorId, msg: AdapterSignalingMessage): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('P2pcfWorkerAdapter: not connected');
    }
    this.ws.send(
      JSON.stringify({ kind: 'signal', to: target, from: this.actorId, msg }),
    );
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
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({ kind: 'leave', actorId: this.actorId, sessionId: this.sessionId }),
        );
        this.ws.close(1000, 'leave');
      }
      this.ws = null;
    }
    this.messageCallbacks.clear();
    this.peerJoinCallbacks.clear();
    this.peerLeaveCallbacks.clear();
    this.sessionId = null;
    this.actorId = null;
    log.info('P2PCF adapter left');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _handleWorkerMessage(msg: WorkerMessage): void {
    switch (msg.kind) {
      case 'peer-list':
        // Fire join for each pre-existing peer
        for (const peer of msg.peers) {
          this._fireJoin(peer);
        }
        break;

      case 'peer-join':
        this._fireJoin(msg.actorId);
        break;

      case 'peer-leave':
        this._fireLeave(msg.actorId);
        break;

      case 'signal':
        for (const cb of this.messageCallbacks) {
          cb(msg.from, msg.msg);
        }
        break;

      default: {
        // Exhaustiveness guard — log unknown kinds
        const unknown = msg as { kind: string };
        log.warn('P2PCF: unknown message kind', unknown.kind);
      }
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
