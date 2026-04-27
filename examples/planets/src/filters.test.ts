import { describe, expect, it } from 'vitest';

import { type Planet } from './data.js';
import {
  type FilterMap,
  activeCount,
  compact,
  filterPlanets,
  isEmpty,
  matches,
  matchesAll,
} from './filters.js';

const p = (over: Partial<Planet> = {}): Planet => ({
  name: 'X',
  discovery_year: 2015,
  discovery_method: 'Transit',
  distance_pc: 100,
  mass_earth: 1,
  radius_earth: 1,
  orbital_period_d: 365,
  host_star_temp_k: 5500,
  semi_major_axis_au: 1,
  eq_temp_k: 300,
  ...over,
});

describe('matches', () => {
  it('range filter accepts inclusive endpoints', () => {
    const f = { kind: 'range', dim: 'mass_earth', min: 1, max: 5 } as const;
    expect(matches(p({ mass_earth: 1 }), f)).toBe(true);
    expect(matches(p({ mass_earth: 5 }), f)).toBe(true);
    expect(matches(p({ mass_earth: 0.99 }), f)).toBe(false);
    expect(matches(p({ mass_earth: 5.01 }), f)).toBe(false);
  });
  it('set filter with empty values matches everything (semantically: no filter)', () => {
    const f = { kind: 'set' as const, dim: 'discovery_method' as const, values: [] };
    expect(matches(p(), f)).toBe(true);
  });
  it('set filter accepts only listed values', () => {
    const f = { kind: 'set' as const, dim: 'discovery_method' as const, values: ['Transit', 'Imaging'] };
    expect(matches(p({ discovery_method: 'Transit' }), f)).toBe(true);
    expect(matches(p({ discovery_method: 'Imaging' }), f)).toBe(true);
    expect(matches(p({ discovery_method: 'Microlensing' }), f)).toBe(false);
  });
});

describe('matchesAll', () => {
  const fm: FilterMap = {
    discovery_year: { kind: 'range', dim: 'discovery_year', min: 2010, max: 2020 },
    discovery_method: { kind: 'set', dim: 'discovery_method', values: ['Transit'] },
  };
  it('AND across dimensions', () => {
    expect(matchesAll(p({ discovery_year: 2015, discovery_method: 'Transit' }), fm)).toBe(true);
    expect(matchesAll(p({ discovery_year: 2005, discovery_method: 'Transit' }), fm)).toBe(false);
    expect(matchesAll(p({ discovery_year: 2015, discovery_method: 'Imaging' }), fm)).toBe(false);
  });
  it('exclude option skips one dim (used by self-exclusion in cross-filter)', () => {
    expect(matchesAll(
      p({ discovery_year: 2005, discovery_method: 'Transit' }),
      fm,
      'discovery_year',
    )).toBe(true);
  });
  it('null entries are ignored', () => {
    expect(matchesAll(p(), { discovery_year: null })).toBe(true);
  });
});

describe('filterPlanets', () => {
  it('returns planets matching every active filter', () => {
    const rows = [
      p({ name: 'A', discovery_year: 2015, mass_earth: 1 }),
      p({ name: 'B', discovery_year: 2015, mass_earth: 50 }),
      p({ name: 'C', discovery_year: 2005, mass_earth: 1 }),
    ];
    const out = filterPlanets(rows, {
      discovery_year: { kind: 'range', dim: 'discovery_year', min: 2010, max: 2020 },
      mass_earth: { kind: 'range', dim: 'mass_earth', min: 0.5, max: 10 },
    });
    expect(out.map(r => r.name)).toEqual(['A']);
  });

  it('exclude lets a view ignore its own filter when computing cross-filtered counts', () => {
    const rows = [
      p({ name: 'A', mass_earth: 1, discovery_year: 2015 }),
      p({ name: 'B', mass_earth: 100, discovery_year: 2015 }),
      p({ name: 'C', mass_earth: 1, discovery_year: 2005 }),
    ];
    const fm: FilterMap = {
      mass_earth: { kind: 'range', dim: 'mass_earth', min: 0.5, max: 10 },
      discovery_year: { kind: 'range', dim: 'discovery_year', min: 2010, max: 2020 },
    };
    // The mass_earth view should compute its bins ignoring its own
    // filter so the user can see both bins highlighted (filtered) and
    // the full mass distribution (background).
    const cross = filterPlanets(rows, fm, 'mass_earth');
    expect(cross.map(r => r.name).sort()).toEqual(['A', 'B']);
  });
});

describe('isEmpty / activeCount / compact', () => {
  it('isEmpty true when all values null/undefined', () => {
    expect(isEmpty({})).toBe(true);
    expect(isEmpty({ mass_earth: null })).toBe(true);
  });
  it('isEmpty false when any filter is set', () => {
    expect(isEmpty({ mass_earth: { kind: 'range', dim: 'mass_earth', min: 0, max: 1 } })).toBe(false);
  });
  it('activeCount counts only truthy entries', () => {
    expect(activeCount({})).toBe(0);
    expect(activeCount({ mass_earth: null, radius_earth: null })).toBe(0);
    expect(activeCount({
      mass_earth: { kind: 'range', dim: 'mass_earth', min: 0, max: 1 },
      radius_earth: null,
    })).toBe(1);
  });
  it('compact strips null entries', () => {
    const out = compact({
      mass_earth: { kind: 'range', dim: 'mass_earth', min: 0, max: 1 },
      radius_earth: null,
    });
    expect(out.mass_earth).toBeDefined();
    expect('radius_earth' in out).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Serialization / cross-peer roundtrip
// ---------------------------------------------------------------------------

describe('filter ops serialize round-trip via JSON', () => {
  it('range filter survives JSON.parse(JSON.stringify(filter))', () => {
    const f = { kind: 'range', dim: 'mass_earth', min: 0.5, max: 100 } as const;
    const back = JSON.parse(JSON.stringify(f));
    expect(matches(p({ mass_earth: 50 }), back)).toBe(true);
    expect(matches(p({ mass_earth: 200 }), back)).toBe(false);
  });
  it('set filter survives JSON.parse(JSON.stringify(filter))', () => {
    const f = { kind: 'set' as const, dim: 'discovery_method' as const, values: ['Transit', 'Imaging'] };
    const back = JSON.parse(JSON.stringify(f));
    expect(matches(p({ discovery_method: 'Transit' }), back)).toBe(true);
    expect(matches(p({ discovery_method: 'TTV' }), back)).toBe(false);
  });
});
