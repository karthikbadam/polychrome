import { describe, expect, it, vi } from 'vitest';

import { AdapterRegistry } from '../registry.js';
import type { AdapterContext, SiteAdapter } from '../types.js';

function ctx(): AdapterContext {
  return {
    api: {} as AdapterContext['api'],
    self: { actorId: 'A', name: 'a', color: '#fff' },
    log: vi.fn(),
    warn: vi.fn(),
  };
}

describe('AdapterRegistry', () => {
  it('returns no-op teardown when nothing matches', () => {
    const r = new AdapterRegistry();
    const url = new URL('https://example.com/');
    const teardown = r.install(url, ctx());
    expect(typeof teardown).toBe('function');
    expect(() => teardown()).not.toThrow();
  });

  it('picks the first matching adapter', () => {
    const r = new AdapterRegistry();
    const a: SiteAdapter = { name: 'a', matches: () => true, install: () => () => {} };
    const b: SiteAdapter = { name: 'b', matches: () => true, install: () => () => {} };
    r.register(a);
    r.register(b);
    expect(r.pick(new URL('https://x/'))?.name).toBe('a');
  });

  it('skips adapters whose matcher throws', () => {
    const r = new AdapterRegistry();
    const broken: SiteAdapter = { name: 'broken', matches: () => { throw new Error('x'); }, install: () => () => {} };
    const ok: SiteAdapter = { name: 'ok', matches: () => true, install: () => () => {} };
    r.register(broken);
    r.register(ok);
    expect(r.pick(new URL('https://y/'))?.name).toBe('ok');
  });

  it('install() invokes the adapter and returns its teardown wrapped in error guards', () => {
    const r = new AdapterRegistry();
    const teardown = vi.fn();
    const installSpy = vi.fn(() => teardown);
    r.register({ name: 'x', matches: () => true, install: installSpy });
    const t = r.install(new URL('https://example.com/'), ctx());
    expect(installSpy).toHaveBeenCalledTimes(1);
    t();
    expect(teardown).toHaveBeenCalledTimes(1);

    // Subsequent teardown errors are swallowed.
    teardown.mockImplementation(() => { throw new Error('boom'); });
    expect(() => t()).not.toThrow();
  });

  it('install() returns no-op if adapter.install throws', () => {
    const r = new AdapterRegistry();
    r.register({ name: 'x', matches: () => true, install: () => { throw new Error('init failed'); } });
    const t = r.install(new URL('https://x/'), ctx());
    expect(typeof t).toBe('function');
    expect(() => t()).not.toThrow();
  });

  it('size() reflects registered count', () => {
    const r = new AdapterRegistry();
    expect(r.size()).toBe(0);
    r.register({ name: 'a', matches: () => false, install: () => () => {} });
    r.register({ name: 'b', matches: () => false, install: () => () => {} });
    expect(r.size()).toBe(2);
  });
});
