/**
 * transform.test.ts — Property tests for the OT transform function.
 *
 * TP1 (Diamond property): for any two concurrent ops a and b applied to
 * the same base state s:
 *   apply(transform(b, a), apply(a, s)) ≡ apply(transform(a, b), apply(b, s))
 *
 * We run 1 000 random op pairs via fast-check.
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

import { State } from './state.js';
import { transform } from './transform.js';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const SESSION_ID = 'TEST01' as SessionId;
const ACTOR_A    = 'aaaaaaaa-0000-0000-0000-000000000001' as ActorId;
const ACTOR_B    = 'bbbbbbbb-0000-0000-0000-000000000002' as ActorId;

function baseOp(actorId: ActorId, seq: number): Omit<Operation, 'kind' | 'payload'> {
  return {
    sessionId: SESSION_ID,
    seq:       seq as Seq,
    clientSeq: 1 as ClientSeq,
    actorId,
    ts:        1000,
    parentSeq: 0 as Seq,
  };
}

const arbListId = fc.constantFrom('list1', 'list2', 'list3');
const arbKey    = fc.constantFrom('k1', 'k2', 'k3');
const arbValue  = fc.oneof(fc.integer({ min: 0, max: 100 }), fc.string({ maxLength: 8 }));
const arbSeq    = fc.integer({ min: 1, max: 1000 });

/** Arbitrary for a single Operation. */
const arbOp = (actorId: ActorId, seq: number): fc.Arbitrary<Operation> =>
  fc.oneof(
    // dom_event
    fc.record({ type: fc.constant('click' as const), x: fc.float(), y: fc.float() }).map(p => ({
      ...baseOp(actorId, seq),
      kind:    'dom_event' as const,
      payload: p,
    })),

    // state_set
    fc.record({ key: arbKey, value: arbValue }).map(p => ({
      ...baseOp(actorId, seq),
      kind:    'state_set' as const,
      payload: p,
    })),

    // list_insert
    fc.record({ listId: arbListId, index: fc.nat({ max: 10 }), value: arbValue }).map(p => ({
      ...baseOp(actorId, seq),
      kind:    'list_insert' as const,
      payload: p,
    })),

    // list_delete
    fc.record({ listId: arbListId, index: fc.nat({ max: 10 }) }).map(p => ({
      ...baseOp(actorId, seq),
      kind:    'list_delete' as const,
      payload: p,
    })),

    // viewport
    fc.record({
      tileIndex: fc.nat({ max: 5 }),
      tileTotal: fc.integer({ min: 1, max: 6 }),
      layout:    fc.constantFrom('h' as const, 'v' as const, '2x2' as const),
    }).map(p => ({
      ...baseOp(actorId, seq),
      kind:    'viewport' as const,
      payload: p,
    })),

    // presence
    fc.record({ name: fc.string({ maxLength: 16 }), idle: fc.boolean() }).map(p => ({
      ...baseOp(actorId, seq),
      kind:    'presence' as const,
      payload: p,
    })),

    // checkpoint
    fc.record({ label: fc.string({ maxLength: 8 }) }).map(p => ({
      ...baseOp(actorId, seq),
      kind:    'checkpoint' as const,
      payload: p,
    })),

    // undo
    fc.nat({ max: 50 }).map(targetSeq => ({
      ...baseOp(actorId, seq),
      kind:    'undo' as const,
      payload: { targetSeq: targetSeq as Seq },
    })),

    // kick
    fc.record({ actorId: fc.constantFrom(ACTOR_A, ACTOR_B) }).map(p => ({
      ...baseOp(actorId, seq),
      kind:    'kick' as const,
      payload: p,
    })),

    // cursor_move
    fc.record({ x: fc.float(), y: fc.float() }).map(p => ({
      ...baseOp(actorId, seq),
      kind:    'cursor_move' as const,
      payload: p,
    })),
  );

// ---------------------------------------------------------------------------
// TP1 helper
// ---------------------------------------------------------------------------

/**
 * Apply transform(b, a) and transform(a, b) to two copies of state s,
 * then compare results.
 *
 * TP1: apply(transform(b,a), apply(a,s)) = apply(transform(a,b), apply(b,s))
 */
function tp1(a: Operation, b: Operation, s: State): boolean {
  const bPrime = transform(a, b);   // b' = transform(b against a)
  const aPrime = transform(b, a);   // a' = transform(a against b)

  const leftState  = s.clone().apply(a).apply(bPrime);
  const rightState = s.clone().apply(b).apply(aPrime);

  return leftState.equals(rightState);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/** Arbitrary for a pair of concurrent ops with independently drawn seqs. */
const arbOpPair: fc.Arbitrary<[Operation, Operation]> = fc
  .tuple(arbSeq, arbSeq)
  .chain(([seqA, seqB]) =>
    fc.tuple(arbOp(ACTOR_A, seqA), arbOp(ACTOR_B, seqB)),
  );

describe('transform — TP1 property', () => {
  it('holds for 1000 random op pairs', () => {
    fc.assert(
      fc.property(
        arbOpPair,
        ([a, b]) => {
          const s = new State();
          return tp1(a, b, s);
        },
      ),
      { numRuns: 1000, seed: 42 },
    );
  });
});

// ---------------------------------------------------------------------------
// Concrete cases from the transform table
// ---------------------------------------------------------------------------

describe('transform — concrete cases', () => {
  it('state_set × state_set: same key, a wins (higher seq)', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 10), kind: 'state_set', payload: { key: 'x', value: 1 } };
    const b: Operation = { ...baseOp(ACTOR_B, 5),  kind: 'state_set', payload: { key: 'x', value: 2 } };
    const bPrime = transform(a, b);
    expect((bPrime.payload as { applied?: boolean }).applied).toBe(false);
  });

  it('state_set × state_set: same key, b wins (higher seq)', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 5),  kind: 'state_set', payload: { key: 'x', value: 1 } };
    const b: Operation = { ...baseOp(ACTOR_B, 10), kind: 'state_set', payload: { key: 'x', value: 2 } };
    const bPrime = transform(a, b);
    expect((bPrime.payload as { applied?: boolean }).applied).toBeUndefined();
  });

  it('state_set × state_set: different keys — identity', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 10), kind: 'state_set', payload: { key: 'x', value: 1 } };
    const b: Operation = { ...baseOp(ACTOR_B, 5),  kind: 'state_set', payload: { key: 'y', value: 2 } };
    const bPrime = transform(a, b);
    expect(bPrime).toEqual(b);
  });

  it('list_insert × list_insert: same list, a.idx ≤ b.idx — shift right', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 1), kind: 'list_insert', payload: { listId: 'L', index: 2, value: 'a' } };
    const b: Operation = { ...baseOp(ACTOR_B, 2), kind: 'list_insert', payload: { listId: 'L', index: 3, value: 'b' } };
    const bPrime = transform(a, b);
    expect((bPrime.payload as { index: number }).index).toBe(4);
  });

  it('list_insert × list_insert: a.idx > b.idx — no shift', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 1), kind: 'list_insert', payload: { listId: 'L', index: 5, value: 'a' } };
    const b: Operation = { ...baseOp(ACTOR_B, 2), kind: 'list_insert', payload: { listId: 'L', index: 3, value: 'b' } };
    const bPrime = transform(a, b);
    expect((bPrime.payload as { index: number }).index).toBe(3);
  });

  it('list_insert × list_delete: same list, a.idx ≤ b.idx — shift right', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 1), kind: 'list_insert', payload: { listId: 'L', index: 1, value: 'a' } };
    const b: Operation = { ...baseOp(ACTOR_B, 2), kind: 'list_delete', payload: { listId: 'L', index: 2 } };
    const bPrime = transform(a, b);
    expect((bPrime.payload as { index: number }).index).toBe(3);
  });

  it('list_delete × list_insert: same list, a.idx < b.idx — shift left', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 1), kind: 'list_delete', payload: { listId: 'L', index: 1 } };
    const b: Operation = { ...baseOp(ACTOR_B, 2), kind: 'list_insert', payload: { listId: 'L', index: 3, value: 'b' } };
    const bPrime = transform(a, b);
    expect((bPrime.payload as { index: number }).index).toBe(2);
  });

  it('list_delete × list_insert: a.idx = b.idx — no shift', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 1), kind: 'list_delete', payload: { listId: 'L', index: 3 } };
    const b: Operation = { ...baseOp(ACTOR_B, 2), kind: 'list_insert', payload: { listId: 'L', index: 3, value: 'b' } };
    const bPrime = transform(a, b);
    expect((bPrime.payload as { index: number }).index).toBe(3);
  });

  it('list_delete × list_delete: same index — noop', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 1), kind: 'list_delete', payload: { listId: 'L', index: 2 } };
    const b: Operation = { ...baseOp(ACTOR_B, 2), kind: 'list_delete', payload: { listId: 'L', index: 2 } };
    const bPrime = transform(a, b);
    expect((bPrime.payload as { applied?: boolean }).applied).toBe(false);
  });

  it('list_delete × list_delete: a.idx < b.idx — shift left', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 1), kind: 'list_delete', payload: { listId: 'L', index: 1 } };
    const b: Operation = { ...baseOp(ACTOR_B, 2), kind: 'list_delete', payload: { listId: 'L', index: 3 } };
    const bPrime = transform(a, b);
    expect((bPrime.payload as { index: number }).index).toBe(2);
  });

  it('different list ids — identity for list ops', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 1), kind: 'list_insert', payload: { listId: 'L1', index: 0, value: 'x' } };
    const b: Operation = { ...baseOp(ACTOR_B, 2), kind: 'list_insert', payload: { listId: 'L2', index: 0, value: 'y' } };
    const bPrime = transform(a, b);
    expect(bPrime).toEqual(b);
  });

  it('viewport × viewport: same actor, a wins — noop', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 10), kind: 'viewport', payload: { tileIndex: 0, tileTotal: 2, layout: 'h' } };
    const b: Operation = { ...baseOp(ACTOR_A, 5),  kind: 'viewport', payload: { tileIndex: 1, tileTotal: 2, layout: 'h' } };
    const bPrime = transform(a, b);
    expect((bPrime.payload as { applied?: boolean }).applied).toBe(false);
  });

  it('viewport × viewport: different actors — identity', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 10), kind: 'viewport', payload: { tileIndex: 0, tileTotal: 2, layout: 'h' } };
    const b: Operation = { ...baseOp(ACTOR_B, 5),  kind: 'viewport', payload: { tileIndex: 1, tileTotal: 2, layout: 'h' } };
    const bPrime = transform(a, b);
    expect(bPrime).toEqual(b);
  });

  it('presence × presence: same actor, a wins — noop', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 10), kind: 'presence', payload: { name: 'Alice' } };
    const b: Operation = { ...baseOp(ACTOR_A, 5),  kind: 'presence', payload: { name: 'Bob' } };
    const bPrime = transform(a, b);
    expect((bPrime.payload as { applied?: boolean }).applied).toBe(false);
  });

  it('presence × presence: different actors — identity', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 10), kind: 'presence', payload: { name: 'Alice' } };
    const b: Operation = { ...baseOp(ACTOR_B, 5),  kind: 'presence', payload: { name: 'Bob' } };
    const bPrime = transform(a, b);
    expect(bPrime).toEqual(b);
  });

  it('undo × undo: same targetSeq, a wins — noop', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 10), kind: 'undo', payload: { targetSeq: 3 as Seq } };
    const b: Operation = { ...baseOp(ACTOR_B, 5),  kind: 'undo', payload: { targetSeq: 3 as Seq } };
    const bPrime = transform(a, b);
    expect((bPrime.payload as { applied?: boolean }).applied).toBe(false);
  });

  it('undo × undo: different targetSeq — identity', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 10), kind: 'undo', payload: { targetSeq: 3 as Seq } };
    const b: Operation = { ...baseOp(ACTOR_B, 5),  kind: 'undo', payload: { targetSeq: 7 as Seq } };
    const bPrime = transform(a, b);
    expect(bPrime).toEqual(b);
  });

  it('dom_event × any — identity', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 1), kind: 'dom_event', payload: { type: 'click', x: 0, y: 0 } };
    const b: Operation = { ...baseOp(ACTOR_B, 2), kind: 'state_set', payload: { key: 'k', value: 42 } };
    expect(transform(a, b)).toEqual(b);
  });

  it('cursor_move × any — identity', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 1), kind: 'cursor_move', payload: { x: 10, y: 20 } };
    const b: Operation = { ...baseOp(ACTOR_B, 2), kind: 'state_set', payload: { key: 'k', value: 99 } };
    expect(transform(a, b)).toEqual(b);
  });

  it('checkpoint × any — identity', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 1), kind: 'checkpoint', payload: { label: 'v1' } };
    const b: Operation = { ...baseOp(ACTOR_B, 2), kind: 'list_insert', payload: { listId: 'L', index: 0, value: 'x' } };
    expect(transform(a, b)).toEqual(b);
  });

  it('kick × any — identity', () => {
    const a: Operation = { ...baseOp(ACTOR_A, 1), kind: 'kick', payload: { actorId: ACTOR_B } };
    const b: Operation = { ...baseOp(ACTOR_B, 2), kind: 'state_set', payload: { key: 'k', value: 1 } };
    expect(transform(a, b)).toEqual(b);
  });
});
