/**
 * filters.ts - dimension-keyed filter ops + apply().
 *
 * The shared op surface is intentionally dimension-based, NOT pixel
 * based. A 'range' filter says "discovery_year between 2010 and
 * 2018" - that is meaningful on a peer with a different screen size,
 * a different rendering, or even a different chart layout. Each peer
 * derives the brush extent from its own scales.
 *
 * Filters are stored on a Y.Map under one key per dimension, so any
 * peer can clear an individual dimension without disturbing the rest.
 * A null value means "no filter on this dimension."
 */

import type { Planet, Dim, NumericDim, CategoricalDim } from './data.js';

export type FilterValue =
  | { kind: 'range'; dim: NumericDim; min: number; max: number }
  | { kind: 'set'; dim: CategoricalDim; values: string[] }
  | null;

export type FilterMap = Partial<Record<Dim, FilterValue>>;

export function filterPlanets(rows: readonly Planet[], filters: FilterMap, exclude?: Dim): Planet[] {
  return rows.filter(p => matchesAll(p, filters, exclude));
}

export function matchesAll(p: Planet, filters: FilterMap, exclude?: Dim): boolean {
  for (const [dim, f] of Object.entries(filters) as Array<[Dim, FilterValue | undefined]>) {
    if (!f || dim === exclude) continue;
    if (!matches(p, f)) return false;
  }
  return true;
}

export function matches(p: Planet, f: NonNullable<FilterValue>): boolean {
  if (f.kind === 'range') {
    const v = p[f.dim] as number;
    return v >= f.min && v <= f.max;
  }
  // f.kind === 'set'
  if (f.values.length === 0) return true;
  const v = p[f.dim] as string;
  return f.values.includes(v);
}

/** True if no filter excludes anything. */
export function isEmpty(filters: FilterMap): boolean {
  for (const v of Object.values(filters)) {
    if (v) return false;
  }
  return true;
}

/** Strip dimensions whose filter is null/undefined. */
export function compact(filters: FilterMap): FilterMap {
  const out: FilterMap = {};
  for (const [k, v] of Object.entries(filters) as Array<[Dim, FilterValue | undefined]>) {
    if (v) out[k] = v;
  }
  return out;
}

/** Number of active filters. */
export function activeCount(filters: FilterMap): number {
  let n = 0;
  for (const v of Object.values(filters)) if (v) n++;
  return n;
}
