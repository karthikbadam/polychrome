/**
 * lists.ts - SharedList<T> ordered-list helpers
 *
 * list() returns a SharedList<T> bound to a named list ID.
 * Operations are translated to page/list_op bridge messages.
 */

import { makeLogger } from '@polychrome/protocol';

import { send } from './dispatch.js';

const log = makeLogger('sdk:lists');

export type Unsubscribe = () => void;

export interface SharedList<T> {
  get(): T[];
  insert(index: number, value: T): void;
  delete(index: number): void;
  subscribe(cb: (value: T[]) => void): Unsubscribe;
}

// In-process local mirrors per list ID
const listMap = new Map<string, unknown[]>();
// Per-list subscriber sets
const listSubscriberMap = new Map<string, Set<(value: unknown[]) => void>>();

/**
 * Apply a remote list_insert from the bridge.
 */
export function applyListInsert(listId: string, index: number, value: unknown): void {
  const list = listMap.get(listId) ?? [];
  const next = [...list];
  next.splice(index, 0, value);
  listMap.set(listId, next);
  notifyList(listId, next);
}

/**
 * Apply a remote list_delete from the bridge.
 */
export function applyListDelete(listId: string, index: number): void {
  const list = listMap.get(listId) ?? [];
  const next = [...list];
  next.splice(index, 1);
  listMap.set(listId, next);
  notifyList(listId, next);
}

function notifyList(listId: string, value: unknown[]): void {
  const subs = listSubscriberMap.get(listId);
  if (subs) {
    for (const cb of subs) {
      try {
        cb(value);
      } catch (err) {
        log.error('List subscriber threw for listId', listId, err);
      }
    }
  }
}

/**
 * Create (or return) a SharedList<T> handle for the given list ID.
 */
export function list<T>(listId: string): SharedList<T> {
  if (!listMap.has(listId)) {
    listMap.set(listId, []);
  }

  log.debug('list', listId);

  return {
    get(): T[] {
      return (listMap.get(listId) ?? []) as T[];
    },

    insert(index: number, value: T): void {
      log.debug('list_insert', listId, index, value);
      // Apply locally first for immediate feedback
      applyListInsert(listId, index, value);
      send({ type: 'page/list_op', listId, op: 'insert', index, value });
    },

    delete(index: number): void {
      log.debug('list_delete', listId, index);
      applyListDelete(listId, index);
      send({ type: 'page/list_op', listId, op: 'delete', index });
    },

    subscribe(cb: (value: T[]) => void): Unsubscribe {
      let subs = listSubscriberMap.get(listId);
      if (!subs) {
        subs = new Set();
        listSubscriberMap.set(listId, subs);
      }
      const typedCb = (v: unknown[]) => cb(v as T[]);
      subs.add(typedCb);
      return () => {
        subs!.delete(typedCb);
        if (subs!.size === 0) listSubscriberMap.delete(listId);
      };
    },
  };
}
