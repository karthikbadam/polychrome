/**
 * api.ts - pure factory that builds the polychrome surface on a Y.Doc.
 *
 * Decoupled from y-webrtc/y-websocket so it can be unit-tested with two
 * locally-connected docs (no actual transport needed).
 *
 * Self-vs-remote filtering: every local mutation runs inside a Yjs
 * transaction whose `origin` is the SELF symbol below. Observers ignore
 * events whose transaction.origin === SELF, which prevents the demo's
 * subscribe → render → set ping-pong loop (a remote update would otherwise
 * trigger the demo's UI to re-emit the same value as a fresh op).
 */

import * as Y from 'yjs';

export interface PolyApi {
  share<T>(key: string, initial?: T): {
    get(): T;
    set(value: T): void;
    subscribe(cb: (value: T) => void): () => void;
  };
  list<T>(listId: string): {
    get(): T[];
    insert(index: number, value: T): void;
    delete(index: number): void;
    subscribe(cb: (items: T[]) => void): () => void;
  };
  checkpoint(label: string): void;
  self: { actorId: string; name: string; color: string };
}

export interface SelfInfo {
  actorId: string;
  name: string;
  color: string;
}

/**
 * Sentinel transaction origin used to mark mutations made by this peer.
 * Subscribers filter events whose `transaction.origin === SELF` to avoid
 * echoing local writes back to the demo's UI.
 */
export const SELF_ORIGIN = Symbol('polychrome-kiosk-self');

export function createPolyApi(ydoc: Y.Doc, self: SelfInfo): PolyApi {
  const yKeys = ydoc.getMap<unknown>('keys');

  function getList(listId: string): Y.Array<unknown> {
    return ydoc.getArray<unknown>(`list:${listId}`);
  }

  return {
    self,

    share<T>(key: string, initial?: T) {
      // Seed once after a short delay to let any peer-state sync arrive
      // first. Y.Map's CRDT semantics are last-writer-wins per key, so even
      // if multiple late-joiners seed concurrently they converge.
      if (initial !== undefined) {
        setTimeout(() => {
          if (!yKeys.has(key)) {
            ydoc.transact(() => yKeys.set(key, initial as unknown), SELF_ORIGIN);
          }
        }, 500);
      }
      return {
        get: (): T => yKeys.get(key) as T,
        set: (value: T): void => {
          ydoc.transact(() => yKeys.set(key, value as unknown), SELF_ORIGIN);
        },
        subscribe(cb: (value: T) => void): () => void {
          const obs = (e: Y.YMapEvent<unknown>, t: Y.Transaction): void => {
            if (t.origin === SELF_ORIGIN) return;
            if (e.keysChanged.has(key)) cb(yKeys.get(key) as T);
          };
          yKeys.observe(obs);
          if (yKeys.has(key)) cb(yKeys.get(key) as T);
          return () => yKeys.unobserve(obs);
        },
      };
    },

    list<T>(listId: string) {
      const arr = getList(listId);
      return {
        get: (): T[] => arr.toArray() as T[],
        insert: (index: number, value: T): void => {
          ydoc.transact(() => arr.insert(index, [value]), SELF_ORIGIN);
        },
        delete: (index: number): void => {
          ydoc.transact(() => arr.delete(index, 1), SELF_ORIGIN);
        },
        subscribe(cb: (items: T[]) => void): () => void {
          const obs = (_e: Y.YArrayEvent<unknown>, t: Y.Transaction): void => {
            if (t.origin === SELF_ORIGIN) return;
            cb(arr.toArray() as T[]);
          };
          arr.observe(obs);
          // Fire once with current contents so subscribers see late-joined
          // state without waiting for the next remote update.
          cb(arr.toArray() as T[]);
          return () => arr.unobserve(obs);
        },
      };
    },

    checkpoint(label: string): void {
      const arr = getList('checkpoints');
      ydoc.transact(
        () => arr.push([{ at: Date.now(), label, by: self.name }]),
        SELF_ORIGIN,
      );
    },
  };
}
