/**
 * @polychrome/protocol — types.ts
 *
 * Canonical Operation schema and all associated types.
 * Do not change without coordinating across tracks.
 */

// ---------------------------------------------------------------------------
// Branded primitive types
// ---------------------------------------------------------------------------

type Brand<T, B> = T & { readonly __brand: B };

export type SessionId = Brand<string, 'SessionId'>;
export type ActorId   = Brand<string, 'ActorId'>;
export type Seq       = Brand<number, 'Seq'>;
export type ClientSeq = Brand<number, 'ClientSeq'>;

// ---------------------------------------------------------------------------
// TargetRef — addressing a DOM element across peers
// ---------------------------------------------------------------------------

export interface TargetRef {
  selector: string;       // CSS selector, prefer ID-based
  xpath?:   string;       // fallback when selector is ambiguous
  rect?:    { x: number; y: number; w: number; h: number }; // viewport-relative
  text?:    string;       // textContent prefix, last-resort disambiguator
  frameId?: number;       // chrome frame id when not top frame
}

// ---------------------------------------------------------------------------
// OpKind union
// ---------------------------------------------------------------------------

export type OpKind =
  | 'dom_event'
  | 'state_set'
  | 'list_insert'
  | 'list_delete'
  | 'cursor_move'
  | 'presence'
  | 'viewport'
  | 'checkpoint'
  | 'undo'
  | 'kick';

// ---------------------------------------------------------------------------
// OpPayload — per-kind shapes
// ---------------------------------------------------------------------------

export interface DomEventPayload {
  type:      'click' | 'mousedown' | 'mousemove' | 'mouseup' | 'touchstart' | 'touchmove' | 'touchend' | 'keydown' | 'keyup' | 'input' | 'scroll' | 'wheel';
  x?:        number;
  y?:        number;
  button?:   number;
  buttons?:  number;
  key?:      string;
  code?:     string;
  modifiers?: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
  value?:    string;   // for input events
  deltaY?:   number;   // for wheel
  scrollX?:  number;
  scrollY?:  number;
}

export interface StateSetPayload   { key: string; value: unknown; }
export interface ListInsertPayload { listId: string; index: number; value: unknown; }
export interface ListDeletePayload { listId: string; index: number; }
export interface CursorMovePayload { x: number; y: number; }
export interface PresencePayload   { name?: string; color?: string; idle?: boolean; }
export interface ViewportPayload   { tileIndex: number; tileTotal: number; layout: 'h' | 'v' | '2x2' | '2x3' | '3x2'; }
export interface CheckpointPayload { label: string; }
export interface UndoPayload       { targetSeq: Seq; }
export interface KickPayload       { actorId: ActorId; reason?: string; }

export type OpPayload =
  | DomEventPayload
  | StateSetPayload
  | ListInsertPayload
  | ListDeletePayload
  | CursorMovePayload
  | PresencePayload
  | ViewportPayload
  | CheckpointPayload
  | UndoPayload
  | KickPayload;

// ---------------------------------------------------------------------------
// Operation
// ---------------------------------------------------------------------------

export interface Operation {
  sessionId:  SessionId;
  seq:        Seq;         // 0 until leader assigns; canonical after
  clientSeq:  ClientSeq;  // assigned by originating peer
  actorId:    ActorId;
  ts:         number;      // ms since epoch, originator's clock
  parentSeq:  Seq;         // last seq the originator had observed
  kind:       OpKind;
  target?:    TargetRef;   // present for dom_event ops
  payload:    OpPayload;   // discriminated by `kind`
  sig?:       string;      // optional HMAC of (sessionId|seq|payload)
}

// ---------------------------------------------------------------------------
// SharedStateView — snapshot of the shared key-value store
// ---------------------------------------------------------------------------

export type SharedStateView = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Identity and Snapshot record shapes (referenced by messages.ts)
// ---------------------------------------------------------------------------

export interface IdentityRecord {
  actorId:  ActorId;
  name?:    string;
  color?:   string;
}

export interface SnapshotRecord {
  sessionId: SessionId;
  seq:       Seq;
  ts:        number;
  events:    unknown[];  // rrweb events
}
