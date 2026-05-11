/**
 * sim/cluster.test.ts - Full convergence test.
 *
 * 5 peers, 10k random ops, 10% leader churn/s.
 * All peers must converge to identical SharedStateView within the
 * simulated time budget.
 */

import { describe, expect, it } from 'vitest';

import { Cluster } from './cluster.js';

// ---------------------------------------------------------------------------
// Deterministic seeded LCG (reproducible across runs)
// ---------------------------------------------------------------------------

/** Linear congruential generator - fast and deterministic. */
function makeLCG(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    // LCG parameters from Numerical Recipes
    s = Math.imul(1664525, s) + 1013904223 >>> 0;
    return (s >>> 0) / 0x100000000;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cluster convergence', () => {
  it('5 peers, 100 ops - converge', () => {
    const rng     = makeLCG(0xdeadbeef);
    const cluster = new Cluster({ peers: 5, rng, leaderChurnRate: 0.1 });
    const result  = cluster.run(100, 10_000);

    expect(result.opsProcessed).toBe(100);
    // Full convergence check
    cluster.assertConverged();
  });

  it('5 peers, 1 000 ops - converge within 60 000 ms simulated', () => {
    const rng     = makeLCG(0xcafebabe);
    const cluster = new Cluster({ peers: 5, rng, leaderChurnRate: 0.1 });
    const result  = cluster.run(1_000, 60_000);

    expect(result.simulatedMs).toBeLessThanOrEqual(60_000);
    cluster.assertConverged();
  });

  it('5 peers, 10 000 ops - converge (within 60 000 ms simulated)', () => {
    const start   = Date.now();
    const rng     = makeLCG(0x12345678);
    const cluster = new Cluster({
      peers:           5,
      rng,
      baseDelayMs:     5,
      jitterMs:        15,
      leaderChurnRate: 0.1,
    });
    const result = cluster.run(10_000, 60_000);
    const wallMs = Date.now() - start;

    // All peers must have converged.
    cluster.assertConverged();

    // Simulation must have completed within 60 s simulated time.
    expect(result.simulatedMs).toBeLessThanOrEqual(60_000);

    // Log result for CI visibility - allowed in tests.
    // eslint-disable-next-line no-console -- @reason: test reporting only
    (globalThis as { console?: { info(...a: unknown[]): void } }).console?.info(
      `[sim] 5-peer 10k-op result: simulated=${result.simulatedMs}ms wall=${wallMs}ms ops=${result.opsProcessed}`,
    );
  });
});
