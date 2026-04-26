/**
 * signaling/adapters/mdns-fallback.ts
 *
 * Local-LAN signaling adapter (spike / placeholder for v1).
 *
 * The idea is to use chrome.mdns (or the mDNS Service Discovery API) to
 * discover peers on the same network without any external rendezvous server.
 * However, as of Chrome MV3 there is no stable public extension API for
 * advertising or browsing mDNS services.  The private `chrome.mdns` API
 * exists only in ChromeOS and in older Chrome builds; it is not available
 * to regular extensions.
 *
 * v1 status: NOT IMPLEMENTED.
 *
 * All methods throw `not-implemented` to make it obvious when this adapter is
 * accidentally selected.  The conformance test suite skips this adapter with
 * `describe.skip` and records the reason.
 *
 * Future path:
 *   - If Chrome ever exposes a Local Discovery API in MV3, implement here.
 *   - Alternatively, use a WebRTC "hole-punching" trick with a shared LAN
 *     broadcast address (requires a native host).
 *   - Track the issue in https://crbug.com/893481.
 */

import type { ActorId, SessionId } from '@polychrome/protocol';
import { makeLogger } from '@polychrome/protocol';

import type { AdapterSignalingMessage, SignalingAdapter, Unsubscribe } from '../adapter.js';

const log = makeLogger('signaling:mdns');

export const MDNS_NOT_IMPLEMENTED_REASON =
  'mdns-fallback: not implemented in v1 — no stable mDNS API in Chrome MV3';

export class MdnsFallbackAdapter implements SignalingAdapter {
  async join(_sessionId: SessionId, _actorId: ActorId): Promise<void> {
    log.warn(MDNS_NOT_IMPLEMENTED_REASON);
    throw new Error(MDNS_NOT_IMPLEMENTED_REASON);
  }

  async sendTo(_target: ActorId, _msg: AdapterSignalingMessage): Promise<void> {
    throw new Error(MDNS_NOT_IMPLEMENTED_REASON);
  }

  onMessage(_cb: (from: ActorId, msg: AdapterSignalingMessage) => void): Unsubscribe {
    throw new Error(MDNS_NOT_IMPLEMENTED_REASON);
  }

  onPeerJoin(_cb: (actorId: ActorId) => void): Unsubscribe {
    throw new Error(MDNS_NOT_IMPLEMENTED_REASON);
  }

  onPeerLeave(_cb: (actorId: ActorId) => void): Unsubscribe {
    throw new Error(MDNS_NOT_IMPLEMENTED_REASON);
  }

  async leave(): Promise<void> {
    // No-op: never joined.
  }
}
