/**
 * types.ts - shared types for site adapters.
 *
 * An adapter is a small piece of code that bridges a third-party
 * page's interactivity into PolyChrome's shared state. The bridge
 * picks the matching adapter for the current URL, hands it the
 * page's polychrome API, and lets the adapter wire DOM/library
 * events to share()/list() calls and back.
 */

import type { PolyApi } from '@polychrome/kiosk';

export interface Identity {
  actorId: string;
  name: string;
  color: string;
}

export interface AdapterContext {
  /** The page-side polychrome API (already installed by the bridge). */
  api: PolyApi;
  /** This peer's identity, in case the adapter wants to attribute updates. */
  self: Identity;
  /** Logger - prefixes with the adapter name and writes to console.debug. */
  log: (...args: unknown[]) => void;
  /** Called for adapter-internal errors. */
  warn: (...args: unknown[]) => void;
}

export interface SiteAdapter {
  /** Display name, used by the logger. */
  name: string;
  /**
   * URL predicate. Called once with `new URL(window.location.href)`. The
   * adapter is installed iff this returns true.
   */
  matches: (url: URL) => boolean;
  /**
   * Wire up adapter behavior. Returns a teardown function called when
   * the bridge tears down (room change / page unload).
   */
  install: (ctx: AdapterContext) => () => void;
}
