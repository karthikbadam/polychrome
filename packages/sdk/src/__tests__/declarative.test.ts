/**
 * declarative.test.ts — data-pc-* scanner tests
 */

import type { BridgeEnvelope } from '@polychrome/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


import { createApi } from '../api.js';
import { initDeclarative } from '../declarative.js';

function isBridgeEnvelope(x: unknown): x is BridgeEnvelope {
  return (
    x !== null &&
    typeof x === 'object' &&
    '__polychrome' in x &&
    (x as BridgeEnvelope).__polychrome === true
  );
}

describe('declarative scanner', () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    postMessageSpy = vi.spyOn(window, 'postMessage');
    document.body.innerHTML = '';
  });

  afterEach(() => {
    postMessageSpy.mockRestore();
    document.body.innerHTML = '';
  });

  it('wires a data-pc-share input so that page changes propagate via bridge', () => {
    const api = createApi();

    const input = document.createElement('input');
    input.setAttribute('data-pc-share', 'decl.filter.year');
    input.setAttribute('type', 'text');
    document.body.appendChild(input);

    initDeclarative(api);

    // Simulate user interaction
    input.value = '2015';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const shareCalls = postMessageSpy.mock.calls.filter((call: unknown[]) => {
      const env = call[0];
      return (
        isBridgeEnvelope(env) &&
        env.body.type === 'page/share' &&
        env.body.key === 'decl.filter.year'
      );
    });

    expect(shareCalls.length).toBeGreaterThanOrEqual(1);
    const lastCall = shareCalls[shareCalls.length - 1]!;
    expect((lastCall[0] as BridgeEnvelope).body).toMatchObject({
      type: 'page/share',
      key: 'decl.filter.year',
      value: '2015',
    });
  });

  it('wires a data-pc-checkpoint button to fire a checkpoint on click', () => {
    const api = createApi();

    const btn = document.createElement('button');
    btn.setAttribute('data-pc-checkpoint', 'user-clicked-export');
    document.body.appendChild(btn);

    initDeclarative(api);

    postMessageSpy.mockClear();
    btn.click();

    const cpCalls = postMessageSpy.mock.calls.filter((call: unknown[]) => {
      const env = call[0];
      return isBridgeEnvelope(env) && env.body.type === 'page/checkpoint';
    });

    expect(cpCalls).toHaveLength(1);
    expect((cpCalls[0]![0] as BridgeEnvelope).body).toMatchObject({
      type: 'page/checkpoint',
      label: 'user-clicked-export',
    });
  });

  it('does not double-wire an element when scanned twice', () => {
    const api = createApi();
    const btn = document.createElement('button');
    btn.setAttribute('data-pc-checkpoint', 'dedupe-test');
    document.body.appendChild(btn);

    initDeclarative(api);
    initDeclarative(api); // second scan should be a no-op for this element

    postMessageSpy.mockClear();
    btn.click();

    const cpCalls = postMessageSpy.mock.calls.filter((call: unknown[]) => {
      const env = call[0];
      return (
        isBridgeEnvelope(env) &&
        env.body.type === 'page/checkpoint' &&
        env.body.label === 'dedupe-test'
      );
    });

    // Should fire only once (no double-wiring)
    expect(cpCalls).toHaveLength(1);
  });

  it('wires a data-pc-list element and renders list items', () => {
    const api = createApi();

    const ul = document.createElement('ul');
    ul.setAttribute('data-pc-list', 'decl.annotations');
    document.body.appendChild(ul);

    initDeclarative(api);

    api.list<string>('decl.annotations').insert(0, 'note A');
    api.list<string>('decl.annotations').insert(1, 'note B');

    const lis = ul.querySelectorAll('li');
    expect(lis).toHaveLength(2);
    expect(lis[0]!.textContent).toBe('note A');
    expect(lis[1]!.textContent).toBe('note B');
  });
});
