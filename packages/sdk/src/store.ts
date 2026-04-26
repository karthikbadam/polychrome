/**
 * store.ts - Shared<T> key-value primitives
 *
 * share()     - returns a Shared<T> bound to a named key.
 * subscribe() - read-only subscription shorthand.
 */

import { makeLogger } from '@polychrome/protocol';

import { send } from './dispatch.js';

const log = makeLogger('sdk:store');

export type Unsubscribe = () => void;

export interface Shared<T> {
  get(): T;
  set(value: T): void;
  subscribe(cb: (value: T) => void): Unsubscribe;
}

// In-process local mirror of shared state (set ops are also sent to bridge)
const stateMap = new Map<string, unknown>();
// Per-key subscriber sets
const subscriberMap = new Map<string, Set<(value: unknown) => void>>();

/**
 * Notify all local subscribers for the given key.
 * Called both when the page sets a value AND when the bridge pushes an update.
 */
export function notifyKey(key: string, value: unknown): void {
  stateMap.set(key, value);
  const subs = subscriberMap.get(key);
  if (subs) {
    for (const cb of subs) {
      try {
        cb(value);
      } catch (err) {
        log.error('Subscriber threw for key', key, err);
      }
    }
  }
}

/**
 * Register a raw subscriber for a key (used by the api layer for incoming
 * bridge events).  Returns an unsubscribe fn.
 */
export function _rawSubscribe(key: string, cb: (value: unknown) => void): Unsubscribe {
  let subs = subscriberMap.get(key);
  if (!subs) {
    subs = new Set();
    subscriberMap.set(key, subs);
  }
  subs.add(cb);
  return () => {
    subs!.delete(cb);
    if (subs!.size === 0) subscriberMap.delete(key);
  };
}

/**
 * Create (or return) a Shared<T> handle for the given key.
 */
export function share<T>(key: string, initialValue?: T): Shared<T> {
  // Seed the local mirror only if no value is set yet
  if (!stateMap.has(key) && initialValue !== undefined) {
    stateMap.set(key, initialValue);
  }

  log.debug('share', key);

  // Notify content script that the page is interested in this key
  send({ type: 'page/subscribe', key });

  const shared: Shared<T> = {
    get(): T {
      return stateMap.get(key) as T;
    },

    set(value: T): void {
      log.debug('state_set', key, value);
      notifyKey(key, value);
      send({ type: 'page/share', key, value });
    },

    subscribe(cb: (value: T) => void): Unsubscribe {
      const unsub = _rawSubscribe(key, (v) => cb(v as T));
      return unsub;
    },
  };

  return shared;
}

/**
 * Read-only subscription shorthand.
 */
export function subscribe<T>(key: string, cb: (value: T) => void): Unsubscribe {
  return share<T>(key).subscribe(cb);
}
