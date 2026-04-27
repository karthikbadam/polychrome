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
 *
 * Op-log: every mutation also appends a record into a shared Y.Array
 * `polychrome:oplog`. The record carries enough context (prevValue
 * for state_set, prevValue for list_delete) that an observer can build
 * an inverse and re-apply via this same API to undo the op. The op-log
 * is the source of truth for the side panel's Timeline and for "undo
 * last (yours)".
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
  /** Read-only access to the shared op log + a programmatic undo. */
  history: {
    /** All ops in order, newest last. */
    all(): readonly OpLogRecord[];
    /** Subscribe to log changes (full snapshot each fire). */
    subscribe(cb: (entries: readonly OpLogRecord[]) => void): () => void;
    /**
     * Apply the inverse of the given op to the live state. Returns true
     * if the inverse was applied (op was undoable), false otherwise.
     * Fire-and-forget: the inverse itself is recorded as a fresh op so
     * undo of an undo = redo (same as ot-core's invert semantics).
     */
    undo(record: OpLogRecord): boolean;
    /** Convenience: undo the most recent op authored by `actorId`. */
    undoLastBy(actorId: string): OpLogRecord | null;
  };
}

export interface SelfInfo {
  actorId: string;
  name: string;
  color: string;
}

export type OpLogRecord =
  | { kind: 'state_set'; at: number; by: string; byName: string; byColor: string; key: string; value: unknown; prevValue: unknown; hadPrev: boolean }
  | { kind: 'list_insert'; at: number; by: string; byName: string; byColor: string; listId: string; index: number; value: unknown }
  | { kind: 'list_delete'; at: number; by: string; byName: string; byColor: string; listId: string; index: number; prevValue: unknown }
  | { kind: 'checkpoint'; at: number; by: string; byName: string; byColor: string; label: string };

export const SELF_ORIGIN = Symbol('polychrome-kiosk-self');
/**
 * Marks a mutation as an undo (re-applied inverse) so observers can
 * distinguish replay from fresh user input. Currently the api treats
 * this identically to SELF_ORIGIN at the observer layer; only the op
 * log entry is annotated.
 */
export const UNDO_ORIGIN = Symbol('polychrome-kiosk-undo');

const OPLOG_KEY = 'polychrome:oplog';

export function createPolyApi(ydoc: Y.Doc, self: SelfInfo): PolyApi {
  const yKeys = ydoc.getMap<unknown>('keys');
  const yLog = ydoc.getArray<OpLogRecord>(OPLOG_KEY);

  function getList(listId: string): Y.Array<unknown> {
    return ydoc.getArray<unknown>(`list:${listId}`);
  }

  function record(entry: OpLogRecord): void {
    yLog.push([entry]);
  }

  // Build the public api. Defined as a const so `api.share` / `api.list`
  // can be referenced by `history.undo` to apply inverses through the
  // same observer-aware code path the demos use.
  const api: PolyApi = {
    self,

    share<T>(key: string, initial?: T) {
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
          const hadPrev = yKeys.has(key);
          const prevValue = yKeys.get(key);
          ydoc.transact(() => {
            yKeys.set(key, value as unknown);
            record({
              kind: 'state_set',
              at: Date.now(),
              by: self.actorId, byName: self.name, byColor: self.color,
              key, value: value as unknown,
              prevValue,
              hadPrev,
            });
          }, SELF_ORIGIN);
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
          ydoc.transact(() => {
            arr.insert(index, [value]);
            record({
              kind: 'list_insert',
              at: Date.now(),
              by: self.actorId, byName: self.name, byColor: self.color,
              listId, index, value: value as unknown,
            });
          }, SELF_ORIGIN);
        },
        delete: (index: number): void => {
          const prevValue = arr.get(index);
          ydoc.transact(() => {
            arr.delete(index, 1);
            record({
              kind: 'list_delete',
              at: Date.now(),
              by: self.actorId, byName: self.name, byColor: self.color,
              listId, index, prevValue,
            });
          }, SELF_ORIGIN);
        },
        subscribe(cb: (items: T[]) => void): () => void {
          const obs = (_e: Y.YArrayEvent<unknown>, t: Y.Transaction): void => {
            if (t.origin === SELF_ORIGIN) return;
            cb(arr.toArray() as T[]);
          };
          arr.observe(obs);
          cb(arr.toArray() as T[]);
          return () => arr.unobserve(obs);
        },
      };
    },

    checkpoint(label: string): void {
      const arr = getList('checkpoints');
      ydoc.transact(() => {
        arr.push([{ at: Date.now(), label, by: self.name }]);
        record({
          kind: 'checkpoint',
          at: Date.now(),
          by: self.actorId, byName: self.name, byColor: self.color,
          label,
        });
      }, SELF_ORIGIN);
    },

    history: {
      all() { return yLog.toArray(); },
      subscribe(cb) {
        const obs = (): void => cb(yLog.toArray());
        yLog.observe(obs);
        cb(yLog.toArray());
        return () => yLog.unobserve(obs);
      },
      undo(rec) {
        switch (rec.kind) {
          case 'state_set': {
            // Inverse: restore the previous value (or remove the key if
            // it didn't exist before). yKeys doesn't expose `delete`
            // through the public surface; fall back to `set(undefined)`
            // when there was no prior value - same convention the demos
            // already understand for "absent".
            ydoc.transact(() => {
              if (rec.hadPrev) yKeys.set(rec.key, rec.prevValue);
              else yKeys.delete(rec.key);
              record({
                kind: 'state_set',
                at: Date.now(),
                by: self.actorId, byName: self.name, byColor: self.color,
                key: rec.key,
                value: rec.hadPrev ? rec.prevValue : undefined,
                prevValue: rec.value,
                hadPrev: true,
              });
            }, SELF_ORIGIN);
            return true;
          }
          case 'list_insert': {
            // Inverse: delete at the same index. CRDT semantics may have
            // shifted things, so we only undo if the value at index
            // matches what we inserted; otherwise we noop (out of order).
            const arr = getList(rec.listId);
            const at = arr.get(rec.index);
            if (!deepEqual(at, rec.value)) return false;
            ydoc.transact(() => {
              arr.delete(rec.index, 1);
              record({
                kind: 'list_delete',
                at: Date.now(),
                by: self.actorId, byName: self.name, byColor: self.color,
                listId: rec.listId, index: rec.index, prevValue: rec.value,
              });
            }, SELF_ORIGIN);
            return true;
          }
          case 'list_delete': {
            // Inverse: re-insert at the same index.
            const arr = getList(rec.listId);
            ydoc.transact(() => {
              arr.insert(Math.min(rec.index, arr.length), [rec.prevValue]);
              record({
                kind: 'list_insert',
                at: Date.now(),
                by: self.actorId, byName: self.name, byColor: self.color,
                listId: rec.listId, index: rec.index, value: rec.prevValue,
              });
            }, SELF_ORIGIN);
            return true;
          }
          case 'checkpoint': {
            // Checkpoints are pure annotations; "undo" is a noop.
            return false;
          }
        }
      },
      undoLastBy(actorId) {
        const all = yLog.toArray();
        // Walk backwards skipping checkpoints (not undoable).
        for (let i = all.length - 1; i >= 0; i--) {
          const r = all[i]!;
          if (r.by !== actorId) continue;
          if (r.kind === 'checkpoint') continue;
          if (this.undo(r)) return r;
        }
        return null;
      },
    },
  };

  return api;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}
