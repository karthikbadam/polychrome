/**
 * transform.ts — Pure OT transform function.
 *
 * transform(a, b) returns b' such that:
 *   apply(b', apply(a, s)) ≡ apply(transform(b,a), apply(b, s))   (TP1)
 *
 * The function is deterministic and has no side effects.
 *
 * Transform table (from docs/plan/03-ot-engine.md):
 *
 * a \ b          | dom_event | state_set              | list_insert            | list_delete             | viewport        | presence        | checkpoint | undo            | kick    | cursor_move
 * ---------------|-----------|------------------------|------------------------|-------------------------|-----------------|-----------------|------------|-----------------|---------|------------
 * dom_event      | identity  | identity               | identity               | identity                | identity        | identity        | identity   | identity        | identity| identity
 * state_set      | identity  | LWW (loser→noop)       | identity               | identity                | identity        | identity        | identity   | identity        | identity| identity
 * list_insert    | identity  | identity               | shift-right if a≤b     | shift-left if a<b       | identity        | identity        | identity   | identity        | identity| identity
 * list_delete    | identity  | identity               | shift-left if a≤b      | noop if same idx, else  | identity        | identity        | identity   | identity        | identity| identity
 *                |           |                        |                        |   shift-left if a<b      |                 |                 |            |                 |         |
 * viewport       | identity  | identity               | identity               | identity                | LWW per actor   | identity        | identity   | identity        | identity| identity
 * presence       | identity  | identity               | identity               | identity                | identity        | LWW per actor   | identity   | identity        | identity| identity
 * checkpoint     | identity  | identity               | identity               | identity                | identity        | identity        | identity   | identity        | identity| identity
 * undo           | identity  | identity               | identity               | identity                | identity        | identity        | identity   | later→noop      | identity| identity
 * kick           | identity  | identity               | identity               | identity                | identity        | identity        | identity   | identity        | identity| identity
 * cursor_move    | identity  | identity               | identity               | identity                | identity        | identity        | identity   | identity        | identity| identity
 */

import type {
  ListDeletePayload,
  ListInsertPayload,
  Operation,
  Seq,
  StateSetPayload,
  UndoPayload,
  ViewportPayload,
} from '@polychrome/protocol';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return a copy of op with payload merged with extra fields. */
function withPayload(op: Operation, extra: Record<string, unknown>): Operation {
  return { ...op, payload: { ...op.payload, ...extra } };
}

/** Mark op as a no-op by setting payload.applied = false. */
function noop(op: Operation): Operation {
  return withPayload(op, { applied: false });
}

/**
 * LWW winner: returns whether `seqA` beats `seqB`.
 * seq 0 means "not yet assigned"; treat as losing.
 */
function lwwWins(seqA: Seq, seqB: Seq): boolean {
  return (seqA as number) > (seqB as number);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transform operation `b` against concurrent operation `a`.
 *
 * Both ops share the same parentSeq (they are concurrent).
 * Returns b' — the adjusted version of b that should be applied
 * after a has already been applied to the state.
 *
 * Pure function — no side effects.
 */
export function transform(a: Operation, b: Operation): Operation {
  // Fast path: different list targets — list ops on different lists
  // never interfere.

  switch (a.kind) {
    // -----------------------------------------------------------------------
    case 'dom_event':
    case 'cursor_move':
    case 'checkpoint':
    case 'kick':
      // These never affect indices or shared state that b cares about.
      return b;

    // -----------------------------------------------------------------------
    case 'state_set': {
      if (b.kind !== 'state_set') return b;
      const ap = a.payload as StateSetPayload;
      const bp = b.payload as StateSetPayload;
      if (ap.key !== bp.key) return b;
      // Same key — LWW: higher seq wins; if a wins then b becomes noop.
      if (lwwWins(a.seq, b.seq)) {
        return noop(b);
      }
      return b;
    }

    // -----------------------------------------------------------------------
    case 'list_insert': {
      const ai = (a.payload as ListInsertPayload).index;
      const al = (a.payload as ListInsertPayload).listId;

      switch (b.kind) {
        case 'list_insert': {
          const bp = b.payload as ListInsertPayload;
          if (bp.listId !== al) return b;
          // Shift right if a.idx <= b.idx
          if (ai <= bp.index) {
            return withPayload(b, { index: bp.index + 1 });
          }
          return b;
        }

        case 'list_delete': {
          const bp = b.payload as ListDeletePayload;
          if (bp.listId !== al) return b;
          // Shift right: delete index must increase when insert is before it
          if (ai <= bp.index) {
            return withPayload(b, { index: bp.index + 1 });
          }
          return b;
        }

        default:
          return b;
      }
    }

    // -----------------------------------------------------------------------
    case 'list_delete': {
      const ai = (a.payload as ListDeletePayload).index;
      const al = (a.payload as ListDeletePayload).listId;

      switch (b.kind) {
        case 'list_insert': {
          const bp = b.payload as ListInsertPayload;
          if (bp.listId !== al) return b;
          // Shift left if a.idx <= b.idx (insertion point moves left
          // because the element before it was removed)
          if (ai < bp.index) {
            return withPayload(b, { index: bp.index - 1 });
          }
          // If ai === bp.index, the insert lands at the same slot — keep it.
          return b;
        }

        case 'list_delete': {
          const bp = b.payload as ListDeletePayload;
          if (bp.listId !== al) return b;
          if (ai === bp.index) {
            // Both try to delete the same element — b becomes noop.
            return noop(b);
          }
          if (ai < bp.index) {
            return withPayload(b, { index: bp.index - 1 });
          }
          return b;
        }

        default:
          return b;
      }
    }

    // -----------------------------------------------------------------------
    case 'viewport': {
      if (b.kind !== 'viewport') return b;
      // LWW per actor: only matters if they are the same actor writing viewport.
      if (a.actorId !== b.actorId) return b;
      // Higher seq wins; if a wins then b is noop.
      if (lwwWins(a.seq, b.seq)) {
        return noop(b);
      }
      return b;
    }

    // -----------------------------------------------------------------------
    case 'presence': {
      if (b.kind !== 'presence') return b;
      if (a.actorId !== b.actorId) return b;
      // Higher seq wins.
      if (lwwWins(a.seq, b.seq)) {
        const bvp = b.payload as ViewportPayload; void bvp;
        return noop(b);
      }
      return b;
    }

    // -----------------------------------------------------------------------
    case 'undo': {
      if (b.kind !== 'undo') return b;
      // Both undo the same target — later (higher seq) loses.
      const au = a.payload as UndoPayload;
      const bu = b.payload as UndoPayload;
      if (au.targetSeq !== bu.targetSeq) return b;
      if (lwwWins(a.seq, b.seq)) {
        return noop(b);
      }
      return b;
    }

    // -----------------------------------------------------------------------
    default: {
      const _: never = a.kind;
      void _;
      return b;
    }
  }
}

/**
 * assertNever helper — compile-time exhaustiveness guard.
 * @internal
 */
export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${String(x)}`);
}
