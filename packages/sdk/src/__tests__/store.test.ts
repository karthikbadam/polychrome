/**
 * store.test.ts — Shared<T> tests
 */

import type { BridgeEnvelope } from '@polychrome/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


import { share, subscribe } from '../store.js';

function isBridgeEnvelope(x: unknown): x is BridgeEnvelope {
  return (
    x !== null &&
    typeof x === 'object' &&
    '__polychrome' in x &&
    (x as BridgeEnvelope).__polychrome === true
  );
}

describe('share()', () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    postMessageSpy = vi.spyOn(window, 'postMessage');
  });

  afterEach(() => {
    postMessageSpy.mockRestore();
  });

  it('set() sends a single page/share bridge message', () => {
    const shared = share<number>('store.year', 2000);
    postMessageSpy.mockClear();

    shared.set(2015);

    const shareCalls = postMessageSpy.mock.calls.filter((call: unknown[]) => {
      const env = call[0];
      return isBridgeEnvelope(env) && env.body.type === 'page/share';
    });

    expect(shareCalls).toHaveLength(1);
    expect((shareCalls[0]![0] as BridgeEnvelope).body).toMatchObject({
      type: 'page/share',
      key: 'store.year',
      value: 2015,
    });
  });

  it('get() returns the last set value', () => {
    const s = share<string>('store.name2', 'alice');
    expect(s.get()).toBe('alice');
    s.set('bob');
    expect(s.get()).toBe('bob');
  });

  it('subscribe() is called when set() fires', () => {
    const s = share<number>('store.count2', 0);
    const vals: number[] = [];
    s.subscribe((v) => vals.push(v));

    s.set(1);
    s.set(2);

    expect(vals).toEqual([1, 2]);
  });

  it('unsubscribe() stops future notifications', () => {
    const s = share<number>('store.unsub2', 0);
    const vals: number[] = [];
    const unsub = s.subscribe((v) => vals.push(v));

    s.set(10);
    unsub();
    s.set(20);

    expect(vals).toEqual([10]);
  });
});

describe('subscribe() shorthand', () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    postMessageSpy = vi.spyOn(window, 'postMessage');
  });

  afterEach(() => {
    postMessageSpy.mockRestore();
  });

  it('registers a read-only callback', () => {
    const vals: string[] = [];
    const unsub = subscribe<string>('store.shorthand2', (v) => vals.push(v));

    share<string>('store.shorthand2').set('hello');
    expect(vals).toEqual(['hello']);

    unsub();
    share<string>('store.shorthand2').set('world');
    expect(vals).toEqual(['hello']);
  });
});
