/**
 * state.ts — In-memory SharedStateView implementation.
 *
 * Tracks:
 *   - keys:     Map<string, unknown>            — shared key/value store
 *   - lists:    Map<string, unknown[]>           — named ordered lists
 *   - presence: Map<actorId, PresencePayload>
 *   - viewports:Map<actorId, ViewportPayload>
 *
 * apply(op) is the only mutating method.  clone() and snapshot() are pure.
 */

import type {
  ActorId,
  ListDeletePayload,
  ListInsertPayload,
  Operation,
  PresencePayload,
  StateSetPayload,
  ViewportPayload,
} from '@polychrome/protocol';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * JSON serialisation with deterministic (sorted) key ordering.
 *
 * Plain JSON.stringify depends on insertion order for object keys.  Two peers
 * that build their state via different op orderings (e.g. concurrent list
 * inserts on different lists) may end up with the same logical state but
 * different insertion order in their Maps, producing different JSON strings.
 * Using sorted keys ensures structural equality is key-order-independent.
 */
function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJSON).join(',') + ']';
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as object).sort();
    const pairs = keys.map(
      k => JSON.stringify(k) + ':' + canonicalJSON((value as Record<string, unknown>)[k]),
    );
    return '{' + pairs.join(',') + '}';
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Serialisable snapshot of the shared state (used by invert and sim). */
export interface StateSnapshot {
  keys:      Record<string, unknown>;
  lists:     Record<string, unknown[]>;
  presence:  Record<string, PresencePayload>;
  viewports: Record<string, ViewportPayload>;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Mutable in-memory state that a single peer maintains.
 * All writes go through apply(op) to ensure we can clone/snapshot cleanly.
 */
export class State {
  private readonly _keys:      Map<string, unknown>;
  private readonly _lists:     Map<string, unknown[]>;
  private readonly _presence:  Map<ActorId, PresencePayload>;
  private readonly _viewports: Map<ActorId, ViewportPayload>;

  constructor(init?: StateSnapshot) {
    this._keys      = init
      ? new Map(Object.entries(init.keys))
      : new Map();
    this._lists     = init
      ? new Map(Object.entries(init.lists).map(([k, v]) => [k, [...v]]))
      : new Map();
    this._presence  = init
      ? new Map(Object.entries(init.presence) as [ActorId, PresencePayload][])
      : new Map();
    this._viewports = init
      ? new Map(Object.entries(init.viewports) as [ActorId, ViewportPayload][])
      : new Map();
  }

  /** Retrieve a key's value (undefined if not set). */
  getKey(key: string): unknown {
    return this._keys.get(key);
  }

  /** Whether a key has been set (distinguishes from `value=undefined`). */
  hasKey(key: string): boolean {
    return this._keys.has(key);
  }

  /** Retrieve a list by id (returns a copy; empty array if not set). */
  getList(listId: string): unknown[] {
    const l = this._lists.get(listId);
    return l ? [...l] : [];
  }

  /** Retrieve presence for an actor. */
  getPresence(actorId: ActorId): PresencePayload | undefined {
    return this._presence.get(actorId);
  }

  /** Retrieve viewport for an actor. */
  getViewport(actorId: ActorId): ViewportPayload | undefined {
    return this._viewports.get(actorId);
  }

  /**
   * Apply a confirmed operation to this state.
   * Mutates in place and returns `this` for chaining.
   */
  apply(op: Operation): this {
    // Operations that were made into noops by transform carry applied=false.
    if ((op.payload as { applied?: boolean }).applied === false) {
      return this;
    }

    switch (op.kind) {
      case 'dom_event':
      case 'cursor_move':
      case 'checkpoint':
      case 'kick':
        // These do not modify shared key/list state.
        break;

      case 'state_set': {
        // The `__delete` sentinel marks an inverse for a previously-unset key.
        // Treating it as a delete (rather than `set(key, undefined)`) keeps
        // canonicalJSON of the snapshot byte-identical to the pre-op state.
        const p = op.payload as StateSetPayload & { __delete?: boolean };
        if (p.__delete === true) {
          this._keys.delete(p.key);
        } else {
          this._keys.set(p.key, p.value);
        }
        break;
      }

      case 'list_insert': {
        const p = op.payload as ListInsertPayload;
        const list = this._lists.get(p.listId) ?? [];
        // Out-of-range indices are noops, not clamped.  Clamping breaks TP1
        // because two concurrent ops with out-of-range indices would
        // deterministically converge on different positions depending on
        // which was applied first.
        if (p.index < 0 || p.index > list.length) break;
        list.splice(p.index, 0, p.value);
        this._lists.set(p.listId, list);
        break;
      }

      case 'list_delete': {
        const p = op.payload as ListDeletePayload;
        const list = this._lists.get(p.listId) ?? [];
        if (p.index >= 0 && p.index < list.length) {
          list.splice(p.index, 1);
        }
        // Normalize: remove entry entirely when list becomes empty.
        if (list.length === 0) {
          this._lists.delete(p.listId);
        } else {
          this._lists.set(p.listId, list);
        }
        break;
      }

      case 'presence': {
        const p   = op.payload as PresencePayload;
        const prev = this._presence.get(op.actorId) ?? {};
        this._presence.set(op.actorId, { ...prev, ...p });
        break;
      }

      case 'viewport': {
        const p = op.payload as ViewportPayload;
        this._viewports.set(op.actorId, p);
        break;
      }

      case 'undo':
        // The engine resolves undo to a concrete inverse before calling apply;
        // by the time we get here the op.kind will already be the resolved kind.
        // If not yet resolved, it is safe to skip.
        break;

      default: {
        const _: never = op.kind;
        void _;
      }
    }
    return this;
  }

  /** Deep-clone this state (no shared references). */
  clone(): State {
    return new State(this.snapshot());
  }

  /** Produce a plain-object snapshot (safe to JSON.stringify). */
  snapshot(): StateSnapshot {
    const keys: Record<string, unknown> = {};
    for (const [k, v] of this._keys) keys[k] = v;

    const lists: Record<string, unknown[]> = {};
    for (const [k, v] of this._lists) lists[k] = [...v];

    const presence: Record<string, PresencePayload> = {};
    for (const [k, v] of this._presence) presence[k] = { ...v };

    const viewports: Record<string, ViewportPayload> = {};
    for (const [k, v] of this._viewports) viewports[k] = { ...v };

    return { keys, lists, presence, viewports };
  }

  /** Structural equality (used by tests and sim). */
  equals(other: State): boolean {
    return canonicalJSON(this.snapshot()) === canonicalJSON(other.snapshot());
  }
}
