import { describe, expect, it } from 'vitest';

import {
  generateRoomId,
  isValidRoomId,
  randomColor,
  randomName,
} from '../shared.js';

describe('shared helpers', () => {
  it('generateRoomId returns a 6-char id from the safe alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const id = generateRoomId();
      expect(id).toHaveLength(6);
      expect(id).toMatch(/^[a-z2-9]+$/);
    }
  });

  it('isValidRoomId accepts 4-16 lowercase chars from the safe alphabet', () => {
    expect(isValidRoomId('abcd')).toBe(true);
    expect(isValidRoomId('abcd23')).toBe(true);
    expect(isValidRoomId('abcdefghijklmnop')).toBe(true);
    // boundary
    expect(isValidRoomId('abc')).toBe(false);
    expect(isValidRoomId('a'.repeat(17))).toBe(false);
    // bad chars
    expect(isValidRoomId('ABCD')).toBe(false);
    expect(isValidRoomId('abc1')).toBe(false); // 1 excluded
    expect(isValidRoomId('abc0')).toBe(false); // 0 excluded
    expect(isValidRoomId('abco')).toBe(true);  // o is allowed
    // non-strings
    expect(isValidRoomId(null)).toBe(false);
    expect(isValidRoomId(123)).toBe(false);
  });

  it('randomName / randomColor draw from the in-bundle palettes', () => {
    const names = new Set<string>();
    const colors = new Set<string>();
    for (let i = 0; i < 200; i++) {
      names.add(randomName());
      colors.add(randomColor());
    }
    // Both palettes should have produced multiple distinct values.
    expect(names.size).toBeGreaterThan(3);
    expect(colors.size).toBeGreaterThan(3);
    // Every color is a hex string.
    for (const c of colors) expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
