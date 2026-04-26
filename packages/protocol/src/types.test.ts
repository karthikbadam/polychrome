/**
 * types.test.ts — compile-only brand type tests
 *
 * These tests verify that branded types prevent cross-assignment at the
 * TypeScript type level.  The runtime test is a no-op; all assertions
 * live in the TS type system.
 */
import { describe, it, expectTypeOf } from 'vitest';

import type { ActorId, ClientSeq, Seq, SessionId } from './types.js';

describe('branded types', () => {
  it('SessionId is not assignable to ActorId', () => {
    // @ts-expect-error — SessionId must not be assignable to ActorId
    const _bad: ActorId = 'some-string' as SessionId;
    void _bad; // suppress unused warning
  });

  it('ActorId is not assignable to SessionId', () => {
    // @ts-expect-error — ActorId must not be assignable to SessionId
    const _bad: SessionId = 'some-string' as ActorId;
    void _bad;
  });

  it('Seq is not assignable to ClientSeq', () => {
    // @ts-expect-error — Seq must not be assignable to ClientSeq
    const _bad: ClientSeq = 42 as Seq;
    void _bad;
  });

  it('ClientSeq is not assignable to Seq', () => {
    // @ts-expect-error — ClientSeq must not be assignable to Seq
    const _bad: Seq = 42 as ClientSeq;
    void _bad;
  });

  it('SessionId is a string brand', () => {
    const sid = 'G7K2QM' as SessionId;
    expectTypeOf(sid).toMatchTypeOf<string>();
  });

  it('ActorId is a string brand', () => {
    const aid = '123e4567-e89b-12d3-a456-426614174000' as ActorId;
    expectTypeOf(aid).toMatchTypeOf<string>();
  });
});
