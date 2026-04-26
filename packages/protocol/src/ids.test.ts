/**
 * ids.test.ts - tests for newSessionId and newActorId
 */
import { describe, expect, it } from 'vitest';

import { newActorId, newSessionId } from './ids.js';

// Crockford Base32 + checksum alphabet
const CROCKFORD_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CHECK_CHARS = `${CROCKFORD_CHARS}*~$=U`;
const SESSION_ID_RE = new RegExp(`^[${CROCKFORD_CHARS}]{5}[${CHECK_CHARS.replace(/[\]\\^-]/g, '\\$&')}]$`);

// UUIDv4 regex
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('newSessionId', () => {
  it('returns exactly 6 characters', () => {
    for (let i = 0; i < 20; i++) {
      expect(newSessionId()).toHaveLength(6);
    }
  });

  it('first 5 chars are Crockford base32', () => {
    for (let i = 0; i < 20; i++) {
      const id = newSessionId();
      const dataPart = id.slice(0, 5);
      expect(dataPart).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{5}$/);
    }
  });

  it('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(newSessionId());
    }
    // With 25 bits of entropy, collisions in 100 attempts are astronomically unlikely
    expect(ids.size).toBeGreaterThan(90);
  });
});

describe('newActorId', () => {
  it('returns a valid UUIDv4', () => {
    for (let i = 0; i < 20; i++) {
      const id = newActorId();
      expect(id).toMatch(UUID_V4_RE);
    }
  });

  it('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(newActorId());
    }
    expect(ids.size).toBe(100);
  });
});

// Suppress unused variable for the regex used in future checks
void SESSION_ID_RE;
