/**
 * registry.ts - tiny adapter registry.
 *
 * Match-first-wins by registration order. Pure module: no DOM, no
 * `window` access, so it's straightforward to test.
 */

import type { SiteAdapter, AdapterContext } from './types.js';

export class AdapterRegistry {
  private readonly adapters: SiteAdapter[] = [];

  register(adapter: SiteAdapter): void {
    this.adapters.push(adapter);
  }

  /** Find the first adapter whose `matches(url)` returns true. */
  pick(url: URL): SiteAdapter | undefined {
    for (const a of this.adapters) {
      try { if (a.matches(url)) return a; } catch { /* ignore matcher errors */ }
    }
    return undefined;
  }

  /**
   * Install the matching adapter. Returns a teardown function. If no
   * adapter matches, returns a no-op.
   */
  install(url: URL, ctx: AdapterContext): () => void {
    const adapter = this.pick(url);
    if (!adapter) return () => {};
    const prefix = `[polychrome:${adapter.name}]`;
    const wrapped: AdapterContext = {
      ...ctx,
      log: (...args) => { console.debug(prefix, ...args); },
      warn: (...args) => { console.warn(prefix, ...args); },
    };
    try {
      const teardown = adapter.install(wrapped);
      return () => { try { teardown(); } catch { /* ignore */ } };
    } catch (err) {
      wrapped.warn('install threw, skipping adapter:', err);
      return () => {};
    }
  }

  /** Number of registered adapters. */
  size(): number { return this.adapters.length; }
}
