/**
 * @polychrome/protocol — codec.ts
 *
 * encode(env: Envelope): string — serialize to wire format
 * decode(s: string): Envelope  — deserialize from wire format
 *
 * v1: JSON.  The switch on `v` future-proofs the format.
 * Throws on unknown envelope type or version mismatch.
 */

import { log } from './logger.js';
import type { Envelope, EnvelopeType } from './messages.js';

// ---------------------------------------------------------------------------
// Known envelope types (compile-time safe set)
// ---------------------------------------------------------------------------

const KNOWN_TYPES = new Set<EnvelopeType>([
  'op',
  'op_batch',
  'cursor',
  'sync_request',
  'sync_response',
  'leader_claim',
  'leader_grant',
  'hello',
  'incompatible',
]);

function isKnownEnvelopeType(t: unknown): t is EnvelopeType {
  return typeof t === 'string' && KNOWN_TYPES.has(t as EnvelopeType);
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Serialize an Envelope to a JSON string for WebRTC datachannel transmission.
 */
export function encode(env: Envelope): string {
  // Switch is future-proof: add cases for v2, v3, ...
  switch (env.v) {
    case 1:
      return JSON.stringify(env);
    default: {
      // TypeScript narrows this to `never` if Envelope.v is exhaustive,
      // but at runtime future versions could arrive — treat as unknown.
      const _exhaustive: never = env.v;
      throw new Error(`encode: unknown protocol version ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Deserialize an Envelope from a JSON string.
 *
 * Throws `CodecError` if:
 *   - The string is not valid JSON
 *   - The `v` field is not 1
 *   - The `type` field is not a known EnvelopeType
 */
export function decode(s: string): Envelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (err) {
    log.error('codec.decode: invalid JSON', err);
    throw new CodecError(`decode: invalid JSON — ${String(err)}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new CodecError('decode: expected an object');
  }

  const obj = parsed as Record<string, unknown>;

  // Version check
  if (obj['v'] !== 1) {
    const received = obj['v'];
    log.warn('codec.decode: protocol version mismatch', { received });
    throw new CodecError(`decode: unsupported protocol version ${String(received)}`);
  }

  // Type check
  if (!isKnownEnvelopeType(obj['type'])) {
    const received = obj['type'];
    log.warn('codec.decode: unknown envelope type', { received });
    throw new CodecError(`decode: unknown envelope type "${String(received)}"`);
  }

  return obj as unknown as Envelope;
}

// ---------------------------------------------------------------------------
// CodecError
// ---------------------------------------------------------------------------

export class CodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodecError';
  }
}
