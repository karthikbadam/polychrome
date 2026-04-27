/**
 * shared.ts - types and helpers used by background, content, and popup.
 *
 * Pure module (no chrome.* calls), so it's easy to unit-test.
 */

export interface Identity {
  actorId: string;
  name: string;
  color: string;
}

export const ROOM_STORAGE_KEY = 'polychrome.room';
export const IDENTITY_STORAGE_KEY = 'polychrome.identity';

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/** Pushed by the SW to every connected content-script port. */
export type RuntimePushMessage =
  | { type: 'state'; identity: Identity; room: string | null };

/** One-shot requests from the popup to the SW. */
export type RuntimeMessage =
  | { type: 'getState' }
  | { type: 'setRoom'; room: string | null }
  | { type: 'generateRoom' };

export interface RuntimeStateResponse {
  identity: Identity;
  room: string | null;
}

// ---------------------------------------------------------------------------
// Identity helpers
// ---------------------------------------------------------------------------

const ANIMALS = [
  'otter', 'lynx', 'fox', 'crane', 'shark', 'wolf', 'puma', 'orca',
  'heron', 'gecko', 'badger', 'falcon', 'mantis', 'koala', 'tapir',
];

const COLORS = [
  '#7c5cff', '#5cffb1', '#ff5c7c', '#ffc857', '#5ccfff',
  '#ff9f5c', '#ff5cf0', '#a3e635',
];

export function randomName(): string {
  const i = Math.floor(Math.random() * ANIMALS.length);
  return ANIMALS[i] ?? 'otter';
}

export function randomColor(): string {
  const i = Math.floor(Math.random() * COLORS.length);
  return COLORS[i] ?? '#7c5cff';
}

/**
 * Generate a 6-character room id from a base32-ish alphabet.
 * Excludes ambiguous chars (0/O, 1/l).
 */
export function generateRoomId(): string {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  let out = '';
  for (let i = 0; i < 6; i++) {
    const idx = Math.floor(Math.random() * alphabet.length);
    out += alphabet[idx];
  }
  return out;
}

/** Validate a room id is in the expected shape. Used by setRoom. */
export function isValidRoomId(s: unknown): s is string {
  return typeof s === 'string' && /^[a-z2-9]{4,16}$/.test(s);
}
