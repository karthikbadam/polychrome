/**
 * __tests__/throttle.test.ts
 *
 * Tests for createCursorThrottle - verifies ≤30Hz max outbound rate.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCursorThrottle } from '../throttle.js';

describe('createCursorThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not send immediately on schedule()', () => {
    const send = vi.fn();
    const { schedule } = createCursorThrottle(send, 33);
    schedule({ x: 1, y: 2 });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the payload after the interval', () => {
    const send = vi.fn();
    const { schedule } = createCursorThrottle(send, 33);
    schedule({ x: 1, y: 2 });
    vi.advanceTimersByTime(33);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ x: 1, y: 2 });
  });

  it('coalesces burst updates - only last value is sent per window', () => {
    const send = vi.fn();
    const { schedule } = createCursorThrottle(send, 33);

    // Fire 100 updates in the same interval
    for (let i = 0; i < 100; i++) {
      schedule({ x: i, y: i });
    }

    vi.advanceTimersByTime(33);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ x: 99, y: 99 });
  });

  it('stays at ≤30Hz under sustained burst', () => {
    const send = vi.fn();
    const { schedule } = createCursorThrottle(send, 33);
    const DURATION_MS = 1000;

    // Schedule at 1000Hz (one per ms)
    for (let t = 0; t < DURATION_MS; t++) {
      vi.advanceTimersByTime(1);
      schedule({ x: t, y: t });
    }

    const calls = send.mock.calls.length;
    // At 30Hz over 1s we expect ≤31 calls (allowing one initial + one per ~33ms).
    // Strictly: floor(1000 / 33) = 30, but we allow 31 for edge-case timing.
    expect(calls).toBeLessThanOrEqual(31);
    // And we must have sent at least something
    expect(calls).toBeGreaterThan(0);
  });

  it('flush() sends pending immediately', () => {
    const send = vi.fn();
    const { schedule, flush } = createCursorThrottle(send, 33);
    schedule({ x: 5, y: 6 });
    flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ x: 5, y: 6 });
  });

  it('flush() does nothing when nothing pending', () => {
    const send = vi.fn();
    const { flush } = createCursorThrottle(send, 33);
    flush();
    expect(send).not.toHaveBeenCalled();
  });

  it('cancel() discards pending payload', () => {
    const send = vi.fn();
    const { schedule, cancel } = createCursorThrottle(send, 33);
    schedule({ x: 1, y: 2 });
    cancel();
    vi.advanceTimersByTime(33);
    expect(send).not.toHaveBeenCalled();
  });

  it('allows new sends after cancel()', () => {
    const send = vi.fn();
    const { schedule, cancel } = createCursorThrottle(send, 33);
    schedule({ x: 1, y: 2 });
    cancel();
    schedule({ x: 10, y: 20 });
    vi.advanceTimersByTime(33);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ x: 10, y: 20 });
  });
});
