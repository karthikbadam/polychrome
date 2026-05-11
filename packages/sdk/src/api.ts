/**
 * api.ts - PolyChromeApi interface + createApi() factory
 *
 * This module provides the public polychrome object placed on window.polychrome
 * by the page bridge (Track J).  Adapters and page authors interact only with
 * this surface.
 */

import { makeLogger } from '@polychrome/protocol';

import { checkpoint as checkpointFn } from './checkpoint.js';
import { type Unsubscribe, listen, send } from './dispatch.js';
import { applyListDelete, applyListInsert, list as listFn } from './lists.js';
import { notifyKey, share as shareFn, subscribe as subscribeFn } from './store.js';

export type { Shared } from './store.js';
export type { SharedList } from './lists.js';
export type { Unsubscribe };

const log = makeLogger('sdk:api');

// ---------------------------------------------------------------------------
// Actor / peer types
// ---------------------------------------------------------------------------

export interface ActorInfo {
  actorId: string;
  name: string;
  color: string;
}

export interface PeerInfo extends ActorInfo {
  idle: boolean;
}

// ---------------------------------------------------------------------------
// PolyChromeApi
// ---------------------------------------------------------------------------

export interface PolyChromeApi {
  /** Read/write a shared key. Returns a Shared<T> handle. */
  share<T>(key: string, initialValue?: T): import('./store.js').Shared<T>;

  /** Read-only subscription shorthand. */
  subscribe<T>(key: string, cb: (value: T) => void): Unsubscribe;

  /** Ordered list ops. */
  list<T>(listId: string): import('./lists.js').SharedList<T>;

  /** Drop a named checkpoint into the timeline. */
  checkpoint(label: string): void;

  /** Identity of the local actor (set by the bridge after session join). */
  readonly self: ActorInfo;

  /** Other actors currently in the room. */
  peers(): PeerInfo[];

  /** Listen for events pushed from the SW via the bridge. */
  on(event: 'peers' | 'state' | 'replay-start' | 'replay-end', cb: (e: unknown) => void): Unsubscribe;
  off(event: string, cb: (e: unknown) => void): void;
}

// ---------------------------------------------------------------------------
// createApi()
// ---------------------------------------------------------------------------

/**
 * Instantiate a PolyChromeApi object. Called once by the page bridge; the
 * result is placed on window.polychrome.
 */
export function createApi(): PolyChromeApi {
  // Event emitter registry
  const eventListeners = new Map<string, Set<(e: unknown) => void>>();

  // Peer registry (populated by content/event bridge messages)
  let peersCache: PeerInfo[] = [];

  // Self identity (populated by content/event bridge messages after join)
  let selfInfo: ActorInfo = { actorId: '', name: 'Unknown', color: '#888888' };

  // Start listening for inbound bridge messages (content script → SDK)
  listen((msg) => {
    if (msg.type === 'content/event') {
      const eventName = msg.eventName;
      const data = msg.data;
      log.debug('content/event', eventName);

      // Handle well-known events that affect internal state
      if (eventName === 'peers') {
        const incoming = data as PeerInfo[] | undefined;
        if (Array.isArray(incoming)) peersCache = incoming;
      } else if (eventName === 'state') {
        // Bridge pushes full state snapshot: { key: value, ... }
        if (data !== null && typeof data === 'object') {
          for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
            notifyKey(key, value);
          }
        }
      } else if (eventName === 'identity') {
        const id = data as Partial<ActorInfo> | undefined;
        if (id !== null && id !== undefined && typeof id === 'object') {
          selfInfo = {
            actorId: id.actorId ?? selfInfo.actorId,
            name: id.name ?? selfInfo.name,
            color: id.color ?? selfInfo.color,
          };
        }
      } else if (eventName === 'list_insert') {
        const { listId, index, value } = data as { listId: string; index: number; value: unknown };
        applyListInsert(listId, index, value);
      } else if (eventName === 'list_delete') {
        const { listId, index } = data as { listId: string; index: number };
        applyListDelete(listId, index);
      }

      // Fire registered event listeners for the named event
      const subs = eventListeners.get(eventName);
      if (subs) {
        for (const cb of subs) {
          try {
            cb(data);
          } catch (err) {
            log.error('on() listener threw for event', eventName, err);
          }
        }
      }
    }
  });

  // Notify content script that the page bridge is ready
  send({ type: 'page/subscribe', key: '__polychrome_ready__' });

  const api: PolyChromeApi = {
    share<T>(key: string, initialValue?: T) {
      return shareFn<T>(key, initialValue);
    },

    subscribe<T>(key: string, cb: (value: T) => void) {
      return subscribeFn<T>(key, cb);
    },

    list<T>(listId: string) {
      return listFn<T>(listId);
    },

    checkpoint(label: string) {
      checkpointFn(label);
    },

    get self() {
      return selfInfo;
    },

    peers() {
      return [...peersCache];
    },

    on(event: 'peers' | 'state' | 'replay-start' | 'replay-end', cb: (e: unknown) => void) {
      let subs = eventListeners.get(event);
      if (!subs) {
        subs = new Set();
        eventListeners.set(event, subs);
      }
      subs.add(cb);
      log.debug('on', event);
      return () => {
        subs!.delete(cb);
      };
    },

    off(event: string, cb: (e: unknown) => void) {
      const subs = eventListeners.get(event);
      if (subs) {
        subs.delete(cb);
        log.debug('off', event);
      }
    },
  };

  return api;
}
