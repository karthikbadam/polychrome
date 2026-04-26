/**
 * invert.ts — Pure inverse function for every persistent op kind.
 *
 * invert(op, state) returns an Operation that, when applied after op,
 * restores the state to what it was before op was applied.
 *
 * Per-kind inverses (from docs/plan/03-ot-engine.md):
 *   dom_event   → noop (kind kept, applied=false)
 *   state_set   → state_set { key, value: prevValue from state }
 *   list_insert → list_delete { listId, index }
 *   list_delete → list_insert { listId, index, value from state snapshot }
 *   presence    → presence to prior value (or noop if no prior)
 *   viewport    → viewport to prior value (or noop if no prior)
 *   checkpoint  → noop (cannot be undone)
 *   undo        → undo of undo = redo (re-apply targetSeq)
 *   kick        → noop
 *   cursor_move → noop
 */

import type {
  ListDeletePayload,
  ListInsertPayload,
  Operation,
  PresencePayload,
  Seq,
  StateSetPayload,
  UndoPayload,
  ViewportPayload,
} from '@polychrome/protocol';

import type { State } from './state.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Operation skeleton reusing the source op's identity fields.
 * The `target` and `sig` are omitted when absent (exactOptionalPropertyTypes safe).
 */
function base(op: Operation): Omit<Operation, 'kind' | 'payload'> {
  const skeleton: Omit<Operation, 'kind' | 'payload'> = {
    sessionId: op.sessionId,
    seq:       0 as Seq,
    clientSeq: op.clientSeq,
    actorId:   op.actorId,
    ts:        op.ts,
    parentSeq: op.seq, // inverse parentSeq is the op we are inverting
  };
  // Only set target/sig when present (exactOptionalPropertyTypes safe)
  if (op.target !== undefined) (skeleton as Operation).target = op.target;
  if (op.sig    !== undefined) (skeleton as Operation).sig    = op.sig;
  return skeleton;
}

/**
 * Noop operation: retains the original kind but marks the payload
 * with `applied: false` so State.apply skips it.
 */
function noopOf(op: Operation): Operation {
  // We cast through unknown to attach the extra sentinel field without
  // violating the OpPayload union — the `applied` field is a runtime guard
  // only; it is never exposed as part of the public payload type.
  const noopPayload = { ...(op.payload as object), applied: false } as unknown as Operation['payload'];
  return {
    ...base(op),
    kind:    op.kind,
    payload: noopPayload,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the inverse of `op` given the state *before* op was applied.
 *
 * @param op    - The operation to invert.
 * @param state - The state *before* `op` was applied.
 * @returns A new Operation that undoes `op` when applied after it.
 */
export function invert(op: Operation, state: State): Operation {
  switch (op.kind) {
    // -----------------------------------------------------------------------
    case 'dom_event':
    case 'cursor_move':
    case 'checkpoint':
    case 'kick':
      return noopOf(op);

    // -----------------------------------------------------------------------
    case 'state_set': {
      const p = op.payload as StateSetPayload;
      // If the key wasn't present before, the inverse must DELETE it, not
      // set it to undefined.  We carry a `__delete: true` sentinel that
      // State.apply recognises.
      if (!state.hasKey(p.key)) {
        const inv: Operation = {
          ...base(op),
          kind:    'state_set',
          payload: { key: p.key, value: undefined, __delete: true } as unknown as StateSetPayload,
        };
        return inv;
      }
      const prevValue = state.getKey(p.key);
      const inv: Operation = {
        ...base(op),
        kind:    'state_set',
        payload: { key: p.key, value: prevValue } satisfies StateSetPayload,
      };
      return inv;
    }

    // -----------------------------------------------------------------------
    case 'list_insert': {
      const p = op.payload as ListInsertPayload;
      // State.apply now treats out-of-range indices as noops.  If this op
      // wouldn't be applied, its inverse must also be a noop.
      const list = state.getList(p.listId);
      if (p.index < 0 || p.index > list.length) {
        return noopOf(op);
      }
      const inv: Operation = {
        ...base(op),
        kind:    'list_delete',
        payload: { listId: p.listId, index: p.index } satisfies ListDeletePayload,
      };
      return inv;
    }

    // -----------------------------------------------------------------------
    case 'list_delete': {
      const p    = op.payload as ListDeletePayload;
      const list = state.getList(p.listId);
      const value = p.index >= 0 && p.index < list.length ? list[p.index] : undefined;
      const inv: Operation = {
        ...base(op),
        kind:    'list_insert',
        payload: { listId: p.listId, index: p.index, value } satisfies ListInsertPayload,
      };
      return inv;
    }

    // -----------------------------------------------------------------------
    case 'presence': {
      const prevPresence = state.getPresence(op.actorId);
      if (prevPresence === undefined) {
        return noopOf(op);
      }
      const inv: Operation = {
        ...base(op),
        kind:    'presence',
        payload: { ...prevPresence } satisfies PresencePayload,
      };
      return inv;
    }

    // -----------------------------------------------------------------------
    case 'viewport': {
      const prevViewport = state.getViewport(op.actorId);
      if (prevViewport === undefined) {
        return noopOf(op);
      }
      const inv: Operation = {
        ...base(op),
        kind:    'viewport',
        payload: { ...prevViewport } satisfies ViewportPayload,
      };
      return inv;
    }

    // -----------------------------------------------------------------------
    case 'undo': {
      // undo of an undo is a redo — emit another undo referencing the same
      // targetSeq so the engine re-applies the original op.
      const p   = op.payload as UndoPayload;
      const inv: Operation = {
        ...base(op),
        kind:    'undo',
        payload: { targetSeq: p.targetSeq } satisfies UndoPayload,
      };
      return inv;
    }

    // -----------------------------------------------------------------------
    default: {
      const _exhaustive: never = op.kind;
      void _exhaustive;
      return noopOf(op);
    }
  }
}
