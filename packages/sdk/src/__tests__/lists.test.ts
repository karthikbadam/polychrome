/**
 * lists.test.ts — SharedList<T> tests
 */

import type { BridgeEnvelope } from '@polychrome/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


import { list } from '../lists.js';

function isBridgeEnvelope(x: unknown): x is BridgeEnvelope {
  return (
    x !== null &&
    typeof x === 'object' &&
    '__polychrome' in x &&
    (x as BridgeEnvelope).__polychrome === true
  );
}

describe('SharedList', () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    postMessageSpy = vi.spyOn(window, 'postMessage');
  });

  afterEach(() => {
    postMessageSpy.mockRestore();
  });

  it('insert() sends a single list_insert bridge message', () => {
    const l = list<string>('lists-insert-test');
    postMessageSpy.mockClear();

    l.insert(0, 'item-a');

    const insertCalls = postMessageSpy.mock.calls.filter((call: unknown[]) => {
      const env = call[0];
      return isBridgeEnvelope(env) && env.body.type === 'page/list_op' && env.body.op === 'insert';
    });

    expect(insertCalls).toHaveLength(1);
    expect((insertCalls[0]![0] as BridgeEnvelope).body).toMatchObject({
      type: 'page/list_op',
      listId: 'lists-insert-test',
      op: 'insert',
      index: 0,
      value: 'item-a',
    });
  });

  it('delete() sends a single list_delete bridge message', () => {
    const l = list<string>('lists-delete-test');
    l.insert(0, 'item-x');
    postMessageSpy.mockClear();

    l.delete(0);

    const deleteCalls = postMessageSpy.mock.calls.filter((call: unknown[]) => {
      const env = call[0];
      return isBridgeEnvelope(env) && env.body.type === 'page/list_op' && env.body.op === 'delete';
    });

    expect(deleteCalls).toHaveLength(1);
    expect((deleteCalls[0]![0] as BridgeEnvelope).body).toMatchObject({
      type: 'page/list_op',
      listId: 'lists-delete-test',
      op: 'delete',
      index: 0,
    });
  });

  it('get() returns the current items', () => {
    const l = list<number>('lists-get-test');
    expect(l.get()).toEqual([]);

    l.insert(0, 10);
    l.insert(1, 20);
    expect(l.get()).toEqual([10, 20]);
  });

  it('subscribe() fires on insert and delete', () => {
    const l = list<string>('lists-sub-test');
    const snapshots: string[][] = [];
    l.subscribe((items) => snapshots.push([...items]));

    l.insert(0, 'a');
    l.insert(1, 'b');
    l.delete(0);

    expect(snapshots).toHaveLength(3);
    expect(snapshots[0]).toEqual(['a']);
    expect(snapshots[1]).toEqual(['a', 'b']);
    expect(snapshots[2]).toEqual(['b']);
  });

  it('subscribe() unsubscribe stops notifications', () => {
    const l = list<string>('lists-unsub-test');
    const snapshots: string[][] = [];
    const unsub = l.subscribe((items) => snapshots.push([...items]));

    l.insert(0, 'x');
    unsub();
    l.insert(1, 'y');

    expect(snapshots).toHaveLength(1);
  });
});
