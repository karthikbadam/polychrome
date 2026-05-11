/**
 * invert.test.ts - Property tests for the invert function.
 *
 * For every persistent op kind:
 *   apply(invert(op, s), apply(op, s)) ≡ s   (round-trip identity)
 *
 * 1 000 random states / ops per kind.
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type {
  ActorId,
  ClientSeq,
  Operation,
  Seq,
  SessionId,
} from '@polychrome/protocol';

import { invert } from './invert.js';
import { State } from './state.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const SESSION_ID: SessionId = 'INV001' as SessionId;
const ACTOR_A: ActorId      = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa' as ActorId;
const ACTOR_B: ActorId      = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb' as ActorId;

function op(
  kind: Operation['kind'],
  payload: Operation['payload'],
  actorId: ActorId = ACTOR_A,
  seq: number = 5,
): Operation {
  return {
    sessionId: SESSION_ID,
    seq:       seq as Seq,
    clientSeq: 1 as ClientSeq,
    actorId,
    ts:        1000,
    parentSeq: 0 as Seq,
    kind,
    payload,
  };
}

const arbValue   = fc.oneof(fc.integer({ min: 0, max: 999 }), fc.string({ maxLength: 6 }));
const arbListId  = fc.constantFrom('L', 'M', 'N');
const arbKey     = fc.constantFrom('a', 'b', 'c');

/** Build a State pre-populated with some data to make inverses interesting. */
const arbState: fc.Arbitrary<State> = fc.array(
  fc.oneof(
    fc.record({ key: arbKey, value: arbValue }).map(p =>
      op('state_set', p),
    ),
    fc.record({ listId: arbListId, index: fc.nat({ max: 3 }), value: arbValue }).map(p =>
      op('list_insert', p),
    ),
  ),
  { minLength: 0, maxLength: 10 },
).map(ops => {
  const s = new State();
  for (const o of ops) s.apply(o);
  return s;
});

// ---------------------------------------------------------------------------
// Round-trip helper
// ---------------------------------------------------------------------------

/**
 * Applies op to a clone of state, inverts the op, applies the inverse,
 * and checks the result equals the original state.
 */
function roundTrip(opToApply: Operation, before: State): boolean {
  const after = before.clone().apply(opToApply);
  const inv   = invert(opToApply, before);
  const final = after.clone().apply(inv);
  return final.equals(before);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('invert - round-trip identity', () => {
  it('state_set: apply then invert restores original', () => {
    fc.assert(
      fc.property(
        arbState,
        arbKey,
        arbValue,
        (state, key, value) => {
          const o = op('state_set', { key, value });
          return roundTrip(o, state);
        },
      ),
      { numRuns: 1000, seed: 1 },
    );
  });

  it('list_insert: apply then invert restores original', () => {
    fc.assert(
      fc.property(
        arbState,
        arbListId,
        fc.nat({ max: 5 }),
        arbValue,
        (state, listId, index, value) => {
          const o = op('list_insert', { listId, index, value });
          return roundTrip(o, state);
        },
      ),
      { numRuns: 1000, seed: 2 },
    );
  });

  it('list_delete: apply then invert restores original', () => {
    fc.assert(
      fc.property(
        arbState,
        arbListId,
        fc.nat({ max: 5 }),
        (state, listId, index) => {
          // Pre-populate list so delete has something to remove.
          const withItem = state.clone();
          withItem.apply(op('list_insert', { listId, index: 0, value: 'sentinel' }));
          const o = op('list_delete', { listId, index: 0 });
          return roundTrip(o, withItem);
        },
      ),
      { numRuns: 1000, seed: 3 },
    );
  });

  it('presence: apply then invert restores original', () => {
    fc.assert(
      fc.property(
        arbState,
        fc.record({ name: fc.string({ maxLength: 10 }), idle: fc.boolean() }),
        fc.record({ name: fc.string({ maxLength: 10 }), idle: fc.boolean() }),
        (state, prevPresence, newPresence) => {
          // Set initial presence so the inverse can recover it.
          const withPresence = state.clone();
          withPresence.apply(op('presence', prevPresence, ACTOR_A, 3));
          const o = op('presence', newPresence, ACTOR_A, 5);
          return roundTrip(o, withPresence);
        },
      ),
      { numRuns: 1000, seed: 4 },
    );
  });

  it('viewport: apply then invert restores original', () => {
    fc.assert(
      fc.property(
        arbState,
        fc.record({
          tileIndex: fc.nat({ max: 5 }),
          tileTotal: fc.integer({ min: 1, max: 6 }),
          layout:    fc.constantFrom('h' as const, 'v' as const, '2x2' as const),
        }),
        fc.record({
          tileIndex: fc.nat({ max: 5 }),
          tileTotal: fc.integer({ min: 1, max: 6 }),
          layout:    fc.constantFrom('h' as const, 'v' as const, '2x2' as const),
        }),
        (state, prevVp, newVp) => {
          const withVp = state.clone();
          withVp.apply(op('viewport', prevVp, ACTOR_A, 3));
          const o = op('viewport', newVp, ACTOR_A, 5);
          return roundTrip(o, withVp);
        },
      ),
      { numRuns: 1000, seed: 5 },
    );
  });

  it('dom_event: invert is a noop (does not change state)', () => {
    fc.assert(
      fc.property(
        arbState,
        (state) => {
          const o = op('dom_event', { type: 'click', x: 10, y: 20 });
          // apply dom_event has no state effect; round-trip trivially holds.
          return roundTrip(o, state);
        },
      ),
      { numRuns: 200, seed: 6 },
    );
  });

  it('checkpoint: invert is a noop (does not change state)', () => {
    fc.assert(
      fc.property(
        arbState,
        (state) => {
          const o = op('checkpoint', { label: 'v1' });
          return roundTrip(o, state);
        },
      ),
      { numRuns: 200, seed: 7 },
    );
  });

  it('kick: invert is a noop (does not change state)', () => {
    fc.assert(
      fc.property(
        arbState,
        (state) => {
          const o = op('kick', { actorId: ACTOR_B });
          return roundTrip(o, state);
        },
      ),
      { numRuns: 200, seed: 8 },
    );
  });

  it('cursor_move: invert is a noop (does not change state)', () => {
    fc.assert(
      fc.property(
        arbState,
        (state) => {
          const o = op('cursor_move', { x: 50, y: 60 });
          return roundTrip(o, state);
        },
      ),
      { numRuns: 200, seed: 9 },
    );
  });

  it('undo: invert of undo is a redo (another undo with same targetSeq)', () => {
    const before = new State();
    const undoOp = op('undo', { targetSeq: 3 as Seq });
    const inv    = invert(undoOp, before);
    // The inverse of an undo is another undo (redo) with the same targetSeq.
    expect(inv.kind).toBe('undo');
    expect((inv.payload as { targetSeq: number }).targetSeq).toBe(3);
  });
});

describe('invert - concrete cases', () => {
  it('state_set: captures prevValue from state', () => {
    const state = new State();
    state.apply(op('state_set', { key: 'x', value: 99 }));
    const setOp = op('state_set', { key: 'x', value: 42 });
    const inv   = invert(setOp, state);
    expect(inv.kind).toBe('state_set');
    expect((inv.payload as { key: string; value: unknown }).value).toBe(99);
  });

  it('list_insert: inverse is list_delete at same index', () => {
    // NOTE: State.apply clamps the insert index to [0, list.length].
    // The inverse must delete at the *actual* (post-clamp) index so that
    // round-trip identity holds.  We pre-populate the list so that index 2
    // is in-bounds and no clamping occurs.
    const state = new State();
    state.apply(op('list_insert', { listId: 'L', index: 0, value: 'a' }));
    state.apply(op('list_insert', { listId: 'L', index: 1, value: 'b' }));
    const insertOp = op('list_insert', { listId: 'L', index: 2, value: 'hello' });
    const inv      = invert(insertOp, state);
    expect(inv.kind).toBe('list_delete');
    expect((inv.payload as { index: number }).index).toBe(2);
  });

  it('list_delete: inverse is list_insert with original value', () => {
    const state = new State();
    state.apply(op('list_insert', { listId: 'L', index: 0, value: 'first' }));
    state.apply(op('list_insert', { listId: 'L', index: 1, value: 'second' }));
    const deleteOp = op('list_delete', { listId: 'L', index: 0 });
    const inv      = invert(deleteOp, state);
    expect(inv.kind).toBe('list_insert');
    expect((inv.payload as { value: unknown }).value).toBe('first');
  });

  it('presence: no prior presence → noop', () => {
    const state    = new State();
    const presOp   = op('presence', { name: 'Alice' }, ACTOR_A);
    const inv      = invert(presOp, state);
    expect((inv.payload as { applied?: boolean }).applied).toBe(false);
  });

  it('viewport: no prior viewport → noop', () => {
    const state  = new State();
    const vpOp   = op('viewport', { tileIndex: 0, tileTotal: 1, layout: 'h' }, ACTOR_A);
    const inv    = invert(vpOp, state);
    expect((inv.payload as { applied?: boolean }).applied).toBe(false);
  });
});
