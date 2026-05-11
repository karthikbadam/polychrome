/**
 * __tests__/mock-adapter.ts
 *
 * In-process linked-pair of SignalingAdapters for unit tests.
 * No real network I/O.
 */

import type { ActorId, SessionId } from '@polychrome/protocol';

import type { AdapterSignalingMessage, SignalingAdapter, Unsubscribe } from '../adapter.js';
import type { AdapterPair } from '../adapters/conformance.js';

type MessageCallback = (from: ActorId, msg: AdapterSignalingMessage) => void;
type PeerJoinCallback  = (actorId: ActorId) => void;
type PeerLeaveCallback = (actorId: ActorId) => void;

class InMemoryAdapter implements SignalingAdapter {
  public actorId: ActorId | null = null;
  public joined = false;

  private messageCallbacks: Set<MessageCallback> = new Set();
  private peerJoinCallbacks: Set<PeerJoinCallback> = new Set();
  private peerLeaveCallbacks: Set<PeerLeaveCallback> = new Set();

  /** The other side of the wire. Set up by makeLinkedPair. */
  public peer: InMemoryAdapter | null = null;

  async join(_sessionId: SessionId, actorId: ActorId): Promise<void> {
    this.actorId = actorId;
    this.joined = true;

    // Notify the other side that we joined
    if (this.peer?.joined) {
      this.peer._fireJoin(actorId);
      // Also tell us about the peer
      this._fireJoin(this.peer.actorId!);
    }
  }

  async sendTo(_target: ActorId, msg: AdapterSignalingMessage): Promise<void> {
    if (!this.joined) throw new Error('InMemoryAdapter: not joined');
    // Deliver asynchronously (via microtask) to simulate real async
    const from = this.actorId!;
    const peer = this.peer;
    if (!peer) return;
    Promise.resolve().then(() => {
      for (const cb of peer.messageCallbacks) {
        cb(from, msg);
      }
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
    if (!this.joined) return;
    this.joined = false;

    const myId = this.actorId!;
    if (this.peer?.joined) {
      this.peer._fireLeave(myId);
    }

    this.messageCallbacks.clear();
    this.peerJoinCallbacks.clear();
    this.peerLeaveCallbacks.clear();
    this.actorId = null;
  }

  _fireJoin(actorId: ActorId): void {
    for (const cb of this.peerJoinCallbacks) {
      cb(actorId);
    }
  }

  _fireLeave(actorId: ActorId): void {
    for (const cb of this.peerLeaveCallbacks) {
      cb(actorId);
    }
  }
}

/** Create a linked pair of in-memory adapters. */
export function makeLinkedPair(): AdapterPair {
  const local  = new InMemoryAdapter();
  const remote = new InMemoryAdapter();
  local.peer  = remote;
  remote.peer = local;
  return { local, remote };
}
