/**
 * codec.test.ts — round-trip tests for encode/decode and every OpKind
 * Also includes the property test: 1000 random ops survive JSON.parse(JSON.stringify(op))
 */
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { CodecError, decode, encode } from './codec.js';
import { wrapBatch, wrapCursor, wrapHello, wrapOp } from './envelope.js';
import type {
  ActorId,
  CheckpointPayload,
  ClientSeq,
  CursorMovePayload,
  DomEventPayload,
  KickPayload,
  ListDeletePayload,
  ListInsertPayload,
  Operation,
  PresencePayload,
  Seq,
  SessionId,
  StateSetPayload,
  UndoPayload,
  ViewportPayload,
} from './types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_ID = 'G7K2QM' as SessionId;
const ACTOR_ID = '123e4567-e89b-12d3-a456-426614174000' as ActorId;
const SEQ_0 = 0 as Seq;
const CLIENT_SEQ_1 = 1 as ClientSeq;

function makeOp(kind: Operation['kind'], payload: Operation['payload']): Operation {
  return {
    sessionId: SESSION_ID,
    seq: SEQ_0,
    clientSeq: CLIENT_SEQ_1,
    actorId: ACTOR_ID,
    ts: Date.now(),
    parentSeq: SEQ_0,
    kind,
    payload,
  };
}

// ---------------------------------------------------------------------------
// Per-kind ops
// ---------------------------------------------------------------------------

const domEventPayload: DomEventPayload = {
  type: 'click',
  x: 960,
  y: 540,
  button: 0,
  buttons: 1,
  modifiers: { alt: false, ctrl: false, meta: false, shift: false },
};

const stateSetPayload: StateSetPayload = { key: 'theme', value: 'dark' };
const listInsertPayload: ListInsertPayload = { listId: 'items', index: 2, value: 'hello' };
const listDeletePayload: ListDeletePayload = { listId: 'items', index: 1 };
const cursorMovePayload: CursorMovePayload = { x: 400, y: 300 };
const presencePayload: PresencePayload = { name: 'Alice', color: '#ff0000', idle: false };
const viewportPayload: ViewportPayload = { tileIndex: 0, tileTotal: 2, layout: 'h' };
const checkpointPayload: CheckpointPayload = { label: 'step-1' };
const undoPayload: UndoPayload = { targetSeq: 5 as Seq };
const kickPayload: KickPayload = { actorId: ACTOR_ID, reason: 'timeout' };

const OP_FIXTURES: Operation[] = [
  makeOp('dom_event', domEventPayload),
  makeOp('state_set', stateSetPayload),
  makeOp('list_insert', listInsertPayload),
  makeOp('list_delete', listDeletePayload),
  makeOp('cursor_move', cursorMovePayload),
  makeOp('presence', presencePayload),
  makeOp('viewport', viewportPayload),
  makeOp('checkpoint', checkpointPayload),
  makeOp('undo', undoPayload),
  makeOp('kick', kickPayload),
];

// ---------------------------------------------------------------------------
// Codec round-trip tests
// ---------------------------------------------------------------------------

describe('codec — encode/decode round-trip', () => {
  it('round-trips wrapOp envelopes for every OpKind', () => {
    for (const op of OP_FIXTURES) {
      const env = wrapOp(op);
      const encoded = encode(env);
      const decoded = decode(encoded);
      expect(decoded).toEqual(env);
    }
  });

  it('round-trips wrapBatch envelope', () => {
    const env = wrapBatch(OP_FIXTURES);
    expect(decode(encode(env))).toEqual(env);
  });

  it('round-trips wrapCursor envelope', () => {
    const env = wrapCursor(cursorMovePayload);
    expect(decode(encode(env))).toEqual(env);
  });

  it('round-trips wrapHello envelope', () => {
    const env = wrapHello(ACTOR_ID);
    expect(decode(encode(env))).toEqual(env);
  });

  it('throws CodecError on invalid JSON', () => {
    expect(() => decode('not json!')).toThrow(CodecError);
  });

  it('throws CodecError on unsupported protocol version', () => {
    const bad = JSON.stringify({ v: 99, type: 'op', body: {} });
    expect(() => decode(bad)).toThrow(CodecError);
  });

  it('throws CodecError on unknown envelope type', () => {
    const bad = JSON.stringify({ v: 1, type: 'unknown_type_xyz', body: {} });
    expect(() => decode(bad)).toThrow(CodecError);
  });

  it('throws CodecError on non-object input', () => {
    expect(() => decode('"just a string"')).toThrow(CodecError);
  });
});

// ---------------------------------------------------------------------------
// Property test: 1000 random ops survive JSON serialization round-trip
// ---------------------------------------------------------------------------

// fast-check arbitraries for branded types
const sessionIdArb = fc.constant(SESSION_ID);
const actorIdArb = fc.constant(ACTOR_ID);
const seqArb = fc.integer({ min: 0, max: 10000 }).map((n) => n as Seq);
const clientSeqArb = fc.integer({ min: 1, max: 10000 }).map((n) => n as ClientSeq);

// Arbitrary for each payload kind
const domEventArb = fc.record<DomEventPayload>({
  type: fc.constantFrom('click', 'mousedown', 'mouseup', 'mousemove', 'keydown', 'keyup', 'input', 'scroll', 'wheel' as const),
  x: fc.option(fc.float({ min: 0, max: 1920, noNaN: true }), { nil: undefined }),
  y: fc.option(fc.float({ min: 0, max: 1080, noNaN: true }), { nil: undefined }),
});

const stateSetArb = fc.record<StateSetPayload>({
  key: fc.string({ minLength: 1, maxLength: 20 }),
  value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
});

const listInsertArb = fc.record<ListInsertPayload>({
  listId: fc.string({ minLength: 1, maxLength: 10 }),
  index: fc.integer({ min: 0, max: 100 }),
  value: fc.string(),
});

const listDeleteArb = fc.record<ListDeletePayload>({
  listId: fc.string({ minLength: 1, maxLength: 10 }),
  index: fc.integer({ min: 0, max: 100 }),
});

const cursorMoveArb = fc.record<CursorMovePayload>({
  x: fc.float({ min: 0, max: 1920, noNaN: true }),
  y: fc.float({ min: 0, max: 1080, noNaN: true }),
});

const presenceArb = fc.record<PresencePayload>({
  name: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
  color: fc.option(fc.string({ maxLength: 7 }), { nil: undefined }),
  idle: fc.option(fc.boolean(), { nil: undefined }),
});

const viewportArb = fc.record<ViewportPayload>({
  tileIndex: fc.integer({ min: 0, max: 5 }),
  tileTotal: fc.integer({ min: 1, max: 6 }),
  layout: fc.constantFrom('h', 'v', '2x2', '2x3', '3x2' as const),
});

const checkpointArb = fc.record<CheckpointPayload>({
  label: fc.string({ minLength: 1, maxLength: 30 }),
});

const undoArb = seqArb.map((s): UndoPayload => ({ targetSeq: s }));

const kickArb = fc.record<KickPayload>({
  actorId: actorIdArb,
  reason: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
});

type PayloadWithKind =
  | { kind: 'dom_event'; payload: DomEventPayload }
  | { kind: 'state_set'; payload: StateSetPayload }
  | { kind: 'list_insert'; payload: ListInsertPayload }
  | { kind: 'list_delete'; payload: ListDeletePayload }
  | { kind: 'cursor_move'; payload: CursorMovePayload }
  | { kind: 'presence'; payload: PresencePayload }
  | { kind: 'viewport'; payload: ViewportPayload }
  | { kind: 'checkpoint'; payload: CheckpointPayload }
  | { kind: 'undo'; payload: UndoPayload }
  | { kind: 'kick'; payload: KickPayload };

const payloadArb: fc.Arbitrary<PayloadWithKind> = fc.oneof(
  domEventArb.map((p): PayloadWithKind => ({ kind: 'dom_event', payload: p })),
  stateSetArb.map((p): PayloadWithKind => ({ kind: 'state_set', payload: p })),
  listInsertArb.map((p): PayloadWithKind => ({ kind: 'list_insert', payload: p })),
  listDeleteArb.map((p): PayloadWithKind => ({ kind: 'list_delete', payload: p })),
  cursorMoveArb.map((p): PayloadWithKind => ({ kind: 'cursor_move', payload: p })),
  presenceArb.map((p): PayloadWithKind => ({ kind: 'presence', payload: p })),
  viewportArb.map((p): PayloadWithKind => ({ kind: 'viewport', payload: p })),
  checkpointArb.map((p): PayloadWithKind => ({ kind: 'checkpoint', payload: p })),
  undoArb.map((p): PayloadWithKind => ({ kind: 'undo', payload: p })),
  kickArb.map((p): PayloadWithKind => ({ kind: 'kick', payload: p })),
);

const operationArb: fc.Arbitrary<Operation> = fc
  .record({
    sessionId: sessionIdArb,
    seq: seqArb,
    clientSeq: clientSeqArb,
    actorId: actorIdArb,
    ts: fc.integer({ min: 0, max: 2e12 }),
    parentSeq: seqArb,
    kindPayload: payloadArb,
  })
  .map(({ kindPayload, ...rest }) => ({
    ...rest,
    kind: kindPayload.kind,
    payload: kindPayload.payload,
  }));

describe('property test — ops survive JSON serialization', () => {
  it('1000 random ops deep-equal after JSON.parse(JSON.stringify(op))', () => {
    fc.assert(
      fc.property(operationArb, (op) => {
        const serialized = JSON.stringify(op);
        const deserialized = JSON.parse(serialized) as Operation;
        expect(deserialized).toEqual(op);
      }),
      { numRuns: 1000 },
    );
  });
});
