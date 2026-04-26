/**
 * dispatch.test.ts - bridge bus tests
 */

import type { BridgeEnvelope } from '@polychrome/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';


import { listen, send } from '../dispatch.js';

describe('send()', () => {
  it('calls window.postMessage with a BridgeEnvelope', () => {
    const spy = vi.spyOn(window, 'postMessage');

    send({ type: 'page/share', key: 'filter.year', value: 2010 });

    expect(spy).toHaveBeenCalledOnce();
    const [envelope] = spy.mock.calls[0]!;
    expect((envelope as BridgeEnvelope).__polychrome).toBe(true);
    expect((envelope as BridgeEnvelope).v).toBe(1);
    expect((envelope as BridgeEnvelope).body).toEqual({
      type: 'page/share',
      key: 'filter.year',
      value: 2010,
    });

    spy.mockRestore();
  });
});

describe('listen()', () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it('fires callback for valid BridgeEnvelope', () => {
    const received: unknown[] = [];
    cleanup = listen((msg) => received.push(msg));

    const envelope: BridgeEnvelope = {
      __polychrome: true,
      v: 1,
      body: { type: 'content/event', eventName: 'peers', data: [] },
    };

    window.dispatchEvent(
      new MessageEvent('message', { data: envelope, source: window })
    );

    expect(received).toHaveLength(1);
    expect((received[0] as { type: string }).type).toBe('content/event');
  });

  it('ignores messages without __polychrome flag', () => {
    const received: unknown[] = [];
    cleanup = listen((msg) => received.push(msg));

    window.dispatchEvent(
      new MessageEvent('message', { data: { some: 'random' }, source: window })
    );

    expect(received).toHaveLength(0);
  });

  it('ignores messages from a different source', () => {
    const received: unknown[] = [];
    cleanup = listen((msg) => received.push(msg));

    const envelope: BridgeEnvelope = {
      __polychrome: true,
      v: 1,
      body: { type: 'content/event', eventName: 'peers', data: [] },
    };

    // source: null simulates cross-origin or iframe
    window.dispatchEvent(
      new MessageEvent('message', { data: envelope, source: null })
    );

    expect(received).toHaveLength(0);
  });

  it('returns an unsubscribe function that stops receiving messages', () => {
    const received: unknown[] = [];
    const unsub = listen((msg) => received.push(msg));

    unsub();

    const envelope: BridgeEnvelope = {
      __polychrome: true,
      v: 1,
      body: { type: 'content/event', eventName: 'peers', data: [] },
    };

    window.dispatchEvent(
      new MessageEvent('message', { data: envelope, source: window })
    );

    expect(received).toHaveLength(0);
  });
});

describe('send() envelope shape', () => {
  it('wraps page/checkpoint in a correct BridgeEnvelope', () => {
    const spy = vi.spyOn(window, 'postMessage');

    send({ type: 'page/checkpoint', label: 'round-trip-test' });

    const [env] = spy.mock.calls[0]!;
    expect((env as BridgeEnvelope).body).toEqual({
      type: 'page/checkpoint',
      label: 'round-trip-test',
    });
    spy.mockRestore();
  });
});
