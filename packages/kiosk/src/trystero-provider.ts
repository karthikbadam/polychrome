/**
 * trystero-provider.ts - Yjs provider backed by Trystero.
 *
 * Why: y-webrtc's public signaling pool (signaling.yjs.dev,
 * y-webrtc-eu.fly.dev, ...) is unreliable. Trystero negotiates SDP
 * via public BitTorrent trackers (wss://tracker.openwebtorrent.com
 * and friends) which have effectively been up forever. The data path
 * is still pure WebRTC; only the signaling is different.
 *
 * Surface: matches the bits of y-webrtc's WebrtcProvider that the
 * kiosk banner / extension bridge / side panel actually read:
 *   - awareness     (y-protocols awareness instance)
 *   - peers         (Map<peerId, true>)        - banner reads .size
 *   - signalingConns ({ connected: true }[])   - banner reads .connected
 *   - disconnect()  - leave the room (graceful)
 *   - destroy()     - same; also tears down listeners
 *
 * The Yjs wire logic is split into bindYjs() so it can be unit-tested
 * with a fake channel pair (no Trystero, no RTCPeerConnection, runs in
 * vitest+jsdom). The provider class is just glue.
 */

import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { joinRoom, getRelaySockets, type Room } from '@trystero-p2p/nostr';

export interface TrysteroProviderOptions {
  /** Trystero appId namespace. Two clients only see each other if they
   * share the same appId AND the same room name. */
  appId?: string;
  /**
   * Override the Nostr relay list. Defaults to a curated set of
   * mainstream relays (relay.damus.io, nos.lol, etc.) which are far
   * more reliable than Trystero's stock relay list.
   */
  relayUrls?: string[];
}

interface SignalingConn { connected: boolean }

const APP_ID_DEFAULT = 'polychrome';

/**
 * Curated mainstream Nostr relays that accept anonymous writes and
 * have lenient rate limits. Trystero's stock list is heavy on obscure
 * community relays and paywalled endpoints; relay.damus.io rate-limits
 * Trystero's announce traffic ('noting too much'); the relays below
 * tolerate the announce volume Trystero produces with a small
 * redundancy=N setup.
 */
const DEFAULT_RELAY_URLS = [
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr-pub.wellorder.net',
  'wss://nostr.mutinywallet.com',
];

// ---------------------------------------------------------------------------
// Pure wire-binding (testable without Trystero)
// ---------------------------------------------------------------------------

export interface YjsChannels {
  sendSync: (data: Uint8Array, peerId?: string) => void;
  onSync: (cb: (data: Uint8Array, peerId: string) => void) => void;
  sendAwareness: (data: Uint8Array, peerId?: string) => void;
  onAwareness: (cb: (data: Uint8Array, peerId: string) => void) => void;
  /** Notifies the bridge a new peer joined the room. */
  onPeerJoin: (cb: (peerId: string) => void) => void;
}

export interface YjsBridge {
  awareness: awarenessProtocol.Awareness;
  destroy: () => void;
}

/**
 * Wire a Y.Doc + Awareness to a pair of broadcast channels. Used by
 * TrysteroProvider; isolated here so tests can drive it with a
 * direct-call fake channel pair.
 */
export function bindYjs(doc: Y.Doc, channels: YjsChannels): YjsBridge {
  const awareness = new awarenessProtocol.Awareness(doc);
  const disposers: Array<() => void> = [];
  const originTag = Symbol('trystero-bridge');

  // Local doc updates → broadcast.
  const onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === originTag) return;
    const enc = encoding.createEncoder();
    syncProtocol.writeUpdate(enc, update);
    channels.sendSync(encoding.toUint8Array(enc));
  };
  doc.on('update', onDocUpdate);
  disposers.push(() => doc.off('update', onDocUpdate));

  // Local awareness changes → broadcast.
  const onAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
  ): void => {
    const changedClients = changes.added.concat(changes.updated, changes.removed);
    channels.sendAwareness(awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients));
  };
  awareness.on('update', onAwarenessUpdate);
  disposers.push(() => awareness.off('update', onAwarenessUpdate));

  // Incoming sync from a peer.
  channels.onSync((data, peerId) => {
    const dec = decoding.createDecoder(data);
    const enc = encoding.createEncoder();
    // Pass `originTag` so our doc-update listener doesn't echo this
    // back as a fresh broadcast.
    syncProtocol.readSyncMessage(dec, enc, doc, originTag);
    if (encoding.length(enc) > 0) channels.sendSync(encoding.toUint8Array(enc), peerId);
  });

  // Incoming awareness update.
  channels.onAwareness((data, peerId) => {
    awarenessProtocol.applyAwarenessUpdate(awareness, data, peerId);
  });

  // New peer joins → send our state vector + the full awareness snapshot.
  channels.onPeerJoin((peerId) => {
    const enc = encoding.createEncoder();
    syncProtocol.writeSyncStep1(enc, doc);
    channels.sendSync(encoding.toUint8Array(enc), peerId);
    const aclients = Array.from(awareness.getStates().keys());
    if (aclients.length > 0) {
      channels.sendAwareness(
        awarenessProtocol.encodeAwarenessUpdate(awareness, aclients),
        peerId,
      );
    }
  });

  return {
    awareness,
    destroy: () => {
      for (const d of disposers) try { d(); } catch { /* ignore */ }
      awareness.destroy();
    },
  };
}

// ---------------------------------------------------------------------------
// Provider (wraps Trystero room around bindYjs)
// ---------------------------------------------------------------------------

export class TrysteroProvider {
  readonly awareness: awarenessProtocol.Awareness;
  readonly peers = new Map<string, true>();
  readonly signalingConns: SignalingConn[] = [{ connected: true }];

  private readonly room: Room;
  private readonly bridge: YjsBridge;
  private readonly roomName: string;
  private destroyed = false;

  constructor(roomName: string, doc: Y.Doc, opts: TrysteroProviderOptions = {}) {
    this.roomName = roomName;
    const relayUrls = opts.relayUrls ?? DEFAULT_RELAY_URLS;
    const room = joinRoom(
      {
        appId: opts.appId ?? APP_ID_DEFAULT,
        relayUrls,
        // Connect to ALL listed relays so two peers reliably share at
        // least one common relay (defaults to a redundancy of 4-5
        // randomly picked from the list, which can leave peers on
        // disjoint relays and unable to discover each other).
        relayRedundancy: relayUrls.length,
      },
      roomName,
      {
        onJoinError: (err) => {
          console.warn('[polychrome] trystero join error:', err);
        },
      },
    );
    this.room = room;
    console.debug('[polychrome] trystero room joined:', roomName, 'relays:', relayUrls);

    const [sendSyncRaw, recvSync] = room.makeAction<Uint8Array>('y.sync');
    const [sendAwarenessRaw, recvAwareness] = room.makeAction<Uint8Array>('y.aware');

    const peers = this.peers;
    const channels: YjsChannels = {
      sendSync: (data, peerId) => {
        void (sendSyncRaw as unknown as (d: Uint8Array, p?: string) => unknown)(data, peerId);
      },
      onSync: (cb) => {
        recvSync((data, peerId) => cb(data, String(peerId)));
      },
      sendAwareness: (data, peerId) => {
        void (sendAwarenessRaw as unknown as (d: Uint8Array, p?: string) => unknown)(data, peerId);
      },
      onAwareness: (cb) => {
        recvAwareness((data, peerId) => cb(data, String(peerId)));
      },
      onPeerJoin: (cb) => {
        room.onPeerJoin((peerId) => {
          peers.set(peerId, true);
          console.debug('[polychrome] peer joined:', peerId, 'total:', peers.size);
          cb(peerId);
        });
      },
    };

    this.bridge = bindYjs(doc, channels);
    this.awareness = this.bridge.awareness;

    room.onPeerLeave((peerId) => {
      this.peers.delete(peerId);
      console.debug('[polychrome] peer left:', peerId, 'total:', peers.size);
    });
  }

  /**
   * Diagnostic: { connected, total } for the underlying Trystero relay
   * sockets. The kiosk banner shows this when the room has zero peers,
   * to help distinguish "relay is down" from "I'm just alone".
   */
  relayState(): { connected: number; total: number } {
    try {
      const sockets = getRelaySockets() as unknown as Record<string, WebSocket | undefined>;
      const entries = Object.entries(sockets ?? {});
      const total = entries.length;
      let connected = 0;
      for (const [, ws] of entries) {
        if (ws && ws.readyState === 1 /* OPEN */) connected++;
      }
      return { connected, total };
    } catch {
      return { connected: 0, total: 0 };
    }
  }

  /** Match WebrtcProvider's API for swap-in compatibility. */
  disconnect(): void { this.destroy(); }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.bridge.destroy();
    this.signalingConns[0]!.connected = false;
    try { this.room.leave(); } catch { /* ignore - already gone */ }
  }
}
