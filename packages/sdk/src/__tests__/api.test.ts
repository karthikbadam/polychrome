/**
 * api.test.ts - PolyChromeApi tests
 */

import type { BridgeEnvelope } from '@polychrome/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


import { createApi } from '../api.js';

function isBridgeEnvelope(x: unknown): x is BridgeEnvelope {
  return (
    x !== null &&
    typeof x === 'object' &&
    '__polychrome' in x &&
    (x as BridgeEnvelope).__polychrome === true
  );
}

describe('createApi()', () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    postMessageSpy = vi.spyOn(window, 'postMessage');
  });

  afterEach(() => {
    postMessageSpy.mockRestore();
  });

  it('returns a PolyChromeApi object with all methods', () => {
    const api = createApi();
    expect(typeof api.share).toBe('function');
    expect(typeof api.subscribe).toBe('function');
    expect(typeof api.list).toBe('function');
    expect(typeof api.checkpoint).toBe('function');
    expect(typeof api.peers).toBe('function');
    expect(typeof api.on).toBe('function');
    expect(typeof api.off).toBe('function');
    expect(api.self).toBeDefined();
  });

  it('share().set() sends page/share bridge message', () => {
    const api = createApi();
    postMessageSpy.mockClear();

    api.share<number>('api.test.key', 0).set(42);

    const shareCalls = postMessageSpy.mock.calls.filter((call: unknown[]) => {
      const env = call[0];
      return isBridgeEnvelope(env) && env.body.type === 'page/share';
    });
    expect(shareCalls.length).toBeGreaterThanOrEqual(1);
    const last = shareCalls[shareCalls.length - 1]!;
    expect((last[0] as BridgeEnvelope).body).toMatchObject({
      type: 'page/share',
      key: 'api.test.key',
      value: 42,
    });
  });

  it('list().insert() sends a single page/list_op bridge message', () => {
    const api = createApi();
    postMessageSpy.mockClear();

    api.list<string>('api.test.list').insert(0, 'hello');

    const insertCalls = postMessageSpy.mock.calls.filter((call: unknown[]) => {
      const env = call[0];
      return isBridgeEnvelope(env) && env.body.type === 'page/list_op' && env.body.op === 'insert';
    });
    expect(insertCalls).toHaveLength(1);
    expect((insertCalls[0]![0] as BridgeEnvelope).body).toMatchObject({
      type: 'page/list_op',
      listId: 'api.test.list',
      op: 'insert',
      index: 0,
      value: 'hello',
    });
  });

  it('checkpoint() sends page/checkpoint bridge message', () => {
    const api = createApi();
    postMessageSpy.mockClear();

    api.checkpoint('my-checkpoint');

    const cpCalls = postMessageSpy.mock.calls.filter((call: unknown[]) => {
      const env = call[0];
      return isBridgeEnvelope(env) && env.body.type === 'page/checkpoint';
    });
    expect(cpCalls).toHaveLength(1);
    expect((cpCalls[0]![0] as BridgeEnvelope).body).toMatchObject({
      type: 'page/checkpoint',
      label: 'my-checkpoint',
    });
  });

  it('peers() returns an array (empty by default)', () => {
    const api = createApi();
    expect(Array.isArray(api.peers())).toBe(true);
    expect(api.peers()).toHaveLength(0);
  });

  it('on() receives events pushed via bridge and unsub() stops them', () => {
    const api = createApi();
    const events: unknown[] = [];
    const cb = (e: unknown): void => { events.push(e); };

    const unsub = api.on('peers', cb);

    // Simulate bridge push
    const envelope: BridgeEnvelope = {
      __polychrome: true,
      v: 1,
      body: {
        type: 'content/event',
        eventName: 'peers',
        data: [{ actorId: 'x', name: 'Alice', color: '#f00', idle: false }],
      },
    };
    window.dispatchEvent(new MessageEvent('message', { data: envelope, source: window }));
    expect(events).toHaveLength(1);

    unsub();
    window.dispatchEvent(new MessageEvent('message', { data: envelope, source: window }));
    expect(events).toHaveLength(1); // no new event after unsub
  });

  it('off() removes a listener', () => {
    const api = createApi();
    const events: unknown[] = [];
    const cb = (e: unknown): void => { events.push(e); };

    api.on('state', cb);

    const envelope: BridgeEnvelope = {
      __polychrome: true,
      v: 1,
      body: { type: 'content/event', eventName: 'state', data: { x: 1 } },
    };
    window.dispatchEvent(new MessageEvent('message', { data: envelope, source: window }));
    expect(events).toHaveLength(1);

    api.off('state', cb);
    window.dispatchEvent(new MessageEvent('message', { data: envelope, source: window }));
    expect(events).toHaveLength(1);
  });

  it('self starts with default identity', () => {
    const api = createApi();
    expect(api.self.actorId).toBe('');
    expect(api.self.name).toBe('Unknown');
    expect(typeof api.self.color).toBe('string');
  });
});
