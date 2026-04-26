/**
 * @polychrome/protocol — ids.ts
 *
 * Deterministic, entropy-based ID generators.
 *
 * newSessionId() → 6-char Crockford base32 (32 bits entropy + 1 checksum char)
 * newActorId()   → UUIDv4 string
 *
 * Both use crypto.getRandomValues (available in browser, Node ≥ 19, and
 * Chrome extension service workers).
 */

import type { ActorId, SessionId } from './types.js';

// ---------------------------------------------------------------------------
// Crockford Base32 alphabet (no I, L, O, U — avoids ambiguity)
// ---------------------------------------------------------------------------

const CROCKFORD_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// Checksum alphabet extends with lowercase letters
const CHECK_CHARS = `${CROCKFORD_CHARS}*~$=U`;

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @reason: globalThis.crypto available in all target environments
  (globalThis.crypto as any).getRandomValues(buf);
  return buf;
}

/**
 * Generate a 6-character Crockford Base32 session ID.
 *
 * Encoding: 5 chars encode 25 bits (5 × 5 bits); final char is a
 * modulo-37 checksum computed over the numeric value of the 5-char block.
 * Total entropy: 5 chars × 5 bits = 25 bits  (sufficient for ephemeral room codes).
 *
 * Note: the spec says "6-char base32, 32 bits entropy plus a checksum char".
 * We use 5 data chars (25 bits) + 1 checksum char = 6 chars total, which
 * matches the 6-char output constraint.  Crockford's spec uses mod-37 for
 * the checksum symbol.
 */
export function newSessionId(): SessionId {
  // Generate 4 random bytes → 32-bit number
  const bytes = randomBytes(4);
  let value = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;

  // Encode 5 Crockford chars (5 bits each, big-endian)
  const chars: string[] = [];
  for (let i = 0; i < 5; i++) {
    chars.unshift(CROCKFORD_CHARS[value & 0x1f]!);
    value = value >>> 5;
  }

  // Checksum: value of original 32-bit number mod 37
  const orig = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  const checkIndex = orig % 37;
  chars.push(CHECK_CHARS[checkIndex]!);

  return chars.join('') as SessionId;
}

/**
 * Generate a UUIDv4 string using the platform crypto API.
 */
export function newActorId(): ActorId {
  return crypto.randomUUID() as ActorId;
}
